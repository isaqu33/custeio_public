/**
 * @jest-environment node
 */
export {};

// "Registrar compra": a purchase typed in by hand credits the stock like an invoice line and is
// kept in the ledger with no invoice. A double submit credits it once.
const connectDBMock = jest.fn();
const ingredientCountMock = jest.fn();
const creditMock = jest.fn();
const recordMock = jest.fn();
const deleteMovementMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/errors', () => ({
  UnprocessableEntityError: class extends Error {},
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { countDocuments: ingredientCountMock },
}));
jest.mock('@/app/lib/services/raw-ingredients', () => ({
  creditRawIngredientPurchase: creditMock,
}));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordManualPurchaseMovement: recordMock,
  deleteMovement: deleteMovementMock,
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ANGUS = '665f735a90788d97f5a76a01';
const COSTELA = '665f735a90788d97f5a76a02';
const AT = new Date('2026-09-28T15:00:00Z');

function input(overrides: Record<string, unknown> = {}) {
  return {
    storeId: STORE_ID,
    requestId: 'req-1',
    userId: 'u1',
    supplierName: 'Açougue do Tião',
    occurredAt: AT,
    lines: [
      { rawIngredientId: ANGUS, quantity: 100, unitCost: 3.75 },
      { rawIngredientId: COSTELA, quantity: 40, unitCost: 4 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  ingredientCountMock.mockResolvedValue(2);
  recordMock.mockResolvedValue({ id: 'm1' });
  creditMock.mockResolvedValue({});
});

describe('registerManualPurchase', () => {
  it('records and credits every line with its value, and reports the total', async () => {
    const { registerManualPurchase } = await import('@/app/lib/services/manual-purchase');

    const result = await registerManualPurchase(input());

    expect(result).toEqual({ applied: 2, skipped: 0, total: 535 }); // 375 + 160
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      rawIngredientId: ANGUS,
      quantity: 100,
      unitCost: 3.75,
      value: 375,
      source: { supplierName: 'Açougue do Tião', manualBatchId: 'req-1', itemIndex: 0 },
    });
    expect(creditMock.mock.calls[0]).toEqual([
      ANGUS,
      {
        convertedQuantity: 100,
        lineValue: 375,
        purchase: { at: AT, supplierCnpj: '', supplierName: 'Açougue do Tião' },
      },
    ]);
    // The movement is written before the credit, so a retry finds the line done.
    expect(recordMock.mock.invocationCallOrder[0]).toBeLessThan(
      creditMock.mock.invocationCallOrder[0]!,
    );
  });

  it('skips a line already credited by an earlier submit of the same entry', async () => {
    recordMock.mockResolvedValueOnce('duplicate');
    const { registerManualPurchase } = await import('@/app/lib/services/manual-purchase');

    const result = await registerManualPurchase(input());

    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    expect(creditMock).toHaveBeenCalledTimes(1);
  });

  it('takes the movement back when the credit fails, so a retry can apply the line', async () => {
    creditMock.mockRejectedValueOnce(new Error('boom'));
    const { registerManualPurchase } = await import('@/app/lib/services/manual-purchase');

    await expect(registerManualPurchase(input())).rejects.toThrow('boom');

    expect(deleteMovementMock).toHaveBeenCalledWith('m1');
  });

  it('rejects an ingredient from another store or a repeated one, before touching anything', async () => {
    const { registerManualPurchase } = await import('@/app/lib/services/manual-purchase');

    ingredientCountMock.mockResolvedValue(1); // one of the two is not in this store
    await expect(registerManualPurchase(input())).rejects.toThrow();
    await expect(
      registerManualPurchase(
        input({
          lines: [
            { rawIngredientId: ANGUS, quantity: 1, unitCost: 1 },
            { rawIngredientId: ANGUS, quantity: 2, unitCost: 1 },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(recordMock).not.toHaveBeenCalled();
    expect(creditMock).not.toHaveBeenCalled();
  });
});
