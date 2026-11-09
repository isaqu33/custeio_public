/**
 * @jest-environment node
 */
export {};

// A cancelled NFe gives its stock back exactly once. Models and the ingredient
// writes are mocked; what is under test is the order of the steps and the
// idempotency, which is where a double refund would come from.
const connectDBMock = jest.fn();
const invoiceFindLeanMock = jest.fn();
const invoiceUpdateMock = jest.fn();
const cancellationUpdateMock = jest.fn();
const cancellationFindLeanMock = jest.fn();
const movementFindLeanMock = jest.fn();
const recordReversalMock = jest.fn();
const deleteMovementMock = jest.fn();
const latestLivePurchaseMock = jest.fn();
const debitMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/processed-invoices', () => ({
  __esModule: true,
  default: {
    findOne: () => ({ select: () => ({ lean: invoiceFindLeanMock }) }),
    updateOne: invoiceUpdateMock,
  },
}));
jest.mock('@/app/models/invoice-cancellations', () => ({
  __esModule: true,
  default: {
    updateOne: cancellationUpdateMock,
    findOne: () => ({ select: () => ({ lean: cancellationFindLeanMock }) }),
  },
}));
jest.mock('@/app/models/stock-movements', () => ({
  __esModule: true,
  default: { find: () => ({ sort: () => ({ lean: movementFindLeanMock }) }) },
}));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordReversalMovement: recordReversalMock,
  deleteMovement: deleteMovementMock,
  getLatestLivePurchase: latestLivePurchaseMock,
}));
jest.mock('@/app/lib/services/raw-ingredients', () => ({
  debitRawIngredientPurchase: debitMock,
}));

const STORE_ID = '665f735a90788d97f5a76322';
const KEY = '35260912345678000199550010000000011234567890';
const CANCELLED_AT = new Date('2026-09-20T13:00:00.000Z');
const ING_A = '665f735a90788d97f5a76401';
const ING_B = '665f735a90788d97f5a76402';

const movement = (rawIngredientId: string, itemIndex: number, quantity: number, value: number) => ({
  storeId: STORE_ID,
  rawIngredientId,
  occurredAt: new Date('2026-09-18T12:00:00.000Z'),
  quantity,
  unitCost: value / quantity,
  value,
  source: { invoiceAccessKey: KEY, itemIndex, supplierCnpj: '1', supplierName: 'Forn' },
});

const load = () => import('@/app/lib/services/nfe-cancellation');

beforeEach(() => {
  jest.clearAllMocks();
  invoiceFindLeanMock.mockResolvedValue({ status: 'processed' });
  recordReversalMock.mockResolvedValue({ id: 'rev-1' });
  latestLivePurchaseMock.mockResolvedValue(null);
});

describe('applyInvoiceCancellation', () => {
  it('remembers the cancellation of an invoice that was never captured', async () => {
    invoiceFindLeanMock.mockResolvedValue(null);
    const { applyInvoiceCancellation } = await load();

    const outcome = await applyInvoiceCancellation(STORE_ID, KEY, {
      cancelledAt: CANCELLED_AT,
      nsu: '000000000000012',
    });

    expect(outcome).toEqual({ status: 'recorded' });
    expect(cancellationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessKey: KEY }),
      { $setOnInsert: { cancelledAt: CANCELLED_AT, nsu: '000000000000012' } },
      { upsert: true },
    );
    expect(debitMock).not.toHaveBeenCalled();
  });

  it('reverses every purchase line, reports the money, and marks the invoice cancelled', async () => {
    movementFindLeanMock.mockResolvedValue([
      movement(ING_A, 0, 5000, 100),
      movement(ING_B, 1, 2000, 40),
    ]);
    const { applyInvoiceCancellation } = await load();

    const outcome = await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT });

    expect(outcome).toEqual({ status: 'reversed', lines: 2, reversedValue: 140 });
    expect(debitMock).toHaveBeenCalledTimes(2);
    expect(debitMock).toHaveBeenCalledWith(
      ING_A,
      expect.objectContaining({ convertedQuantity: 5000, lineValue: 100 }),
    );
    expect(invoiceUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ accessKey: KEY }), {
      $set: { status: 'cancelled', cancelledAt: CANCELLED_AT },
    });
  });

  it('writes the reversal before debiting, so a re-run can tell what is done', async () => {
    movementFindLeanMock.mockResolvedValue([movement(ING_A, 0, 5000, 100)]);
    const { applyInvoiceCancellation } = await load();

    await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT });

    expect(recordReversalMock.mock.invocationCallOrder[0]).toBeLessThan(
      debitMock.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not give a line back twice when its reversal already exists', async () => {
    movementFindLeanMock.mockResolvedValue([
      movement(ING_A, 0, 5000, 100),
      movement(ING_B, 1, 2000, 40),
    ]);
    recordReversalMock.mockResolvedValueOnce('duplicate').mockResolvedValueOnce({ id: 'rev-2' });
    const { applyInvoiceCancellation } = await load();

    const outcome = await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT });

    expect(debitMock).toHaveBeenCalledTimes(1);
    expect(debitMock).toHaveBeenCalledWith(ING_B, expect.anything());
    expect(outcome).toEqual({ status: 'reversed', lines: 1, reversedValue: 40 });
  });

  it('removes the reversal when the debit fails, so a retry applies the line', async () => {
    movementFindLeanMock.mockResolvedValue([movement(ING_A, 0, 5000, 100)]);
    debitMock.mockRejectedValueOnce(new Error('db down'));
    const { applyInvoiceCancellation } = await load();

    await expect(
      applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT }),
    ).rejects.toThrow('db down');

    expect(deleteMovementMock).toHaveBeenCalledWith('rev-1');
    expect(invoiceUpdateMock).not.toHaveBeenCalled(); // still "processed": the retry reverses it
  });

  it('falls back to the latest surviving purchase for cost and last purchase', async () => {
    movementFindLeanMock.mockResolvedValue([movement(ING_A, 0, 5000, 100)]);
    latestLivePurchaseMock.mockResolvedValue({
      occurredAt: new Date('2026-09-10T12:00:00.000Z'),
      quantity: 3000,
      unitCost: 0.018,
      supplierCnpj: '9',
      supplierName: 'Outro',
      invoiceNumber: '77',
    });
    const { applyInvoiceCancellation } = await load();

    await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT });

    expect(debitMock).toHaveBeenCalledWith(
      ING_A,
      expect.objectContaining({
        fallbackUnitCost: 0.018,
        lastPurchase: expect.objectContaining({ supplierName: 'Outro', invoiceNumber: '77' }),
      }),
    );
  });

  it('is a no-op for an invoice already cancelled', async () => {
    invoiceFindLeanMock.mockResolvedValue({ status: 'cancelled' });
    const { applyInvoiceCancellation } = await load();

    expect(await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT })).toEqual({
      status: 'already',
    });
    expect(recordReversalMock).not.toHaveBeenCalled();
  });

  it('only marks an invoice that credited nothing', async () => {
    invoiceFindLeanMock.mockResolvedValue({ status: 'ignored' });
    movementFindLeanMock.mockResolvedValue([]);
    const { applyInvoiceCancellation } = await load();

    expect(await applyInvoiceCancellation(STORE_ID, KEY, { cancelledAt: CANCELLED_AT })).toEqual({
      status: 'marked',
    });
    expect(invoiceUpdateMock).toHaveBeenCalled();
  });
});

describe('findRecordedCancellation', () => {
  it('reads what was remembered for this store and key', async () => {
    cancellationFindLeanMock.mockResolvedValue({ cancelledAt: CANCELLED_AT });
    const { findRecordedCancellation } = await load();

    expect(await findRecordedCancellation(STORE_ID, KEY)).toEqual({ cancelledAt: CANCELLED_AT });
  });
});
