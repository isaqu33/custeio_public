/**
 * @jest-environment node
 */
export {};

// The ledger behind an ingredient's balance. What matters: a purchase is
// idempotent per invoice line (so a half-applied invoice never double-credits),
// adjustments keep before/after, and the history shows how each price moved.
const connectDBMock = jest.fn();
const createMock = jest.fn();
const deleteOneMock = jest.fn();
const findMock = jest.fn();
const sortMock = jest.fn();
const limitMock = jest.fn();
const leanMock = jest.fn();
const aggregateMock = jest.fn();
const distinctMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/stock-movements', () => ({
  __esModule: true,
  default: {
    create: createMock,
    deleteOne: deleteOneMock,
    find: findMock,
    aggregate: aggregateMock,
    distinct: distinctMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ING_ID = '665f735a90788d97f5a76a01';

const purchase = {
  storeId: STORE_ID,
  rawIngredientId: ING_ID,
  occurredAt: new Date('2026-08-11T15:00:00Z'),
  quantity: 5000,
  unitCost: 0.002498,
  value: 12.49,
  source: {
    invoiceAccessKey: '35260912345678000199550010000000011234567890',
    invoiceNumber: '30892',
    invoiceSeries: '1',
    supplierCnpj: '27289076001530',
    supplierName: 'LOJA SANTA MARIA',
    supplierItemCode: 'SKU-1',
    description: 'ACUCAR CRISTAL 5KG UN',
    itemIndex: 3,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({ _id: 'mv-1' });
  deleteOneMock.mockResolvedValue({});
  findMock.mockReturnValue({ sort: sortMock });
  sortMock.mockReturnValue({ limit: limitMock });
  limitMock.mockReturnValue({ lean: leanMock });
  leanMock.mockResolvedValue([]);
  aggregateMock.mockResolvedValue([]);
  distinctMock.mockResolvedValue([]);
});

describe('recordPurchaseMovement', () => {
  it('stores the purchase with its invoice, supplier and landed cost', async () => {
    const { recordPurchaseMovement } = await import('@/app/lib/services/stock-movements');

    const result = await recordPurchaseMovement(purchase);

    expect(result).toEqual({ id: 'mv-1' });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'purchase',
        quantity: 5000,
        unitCost: 0.002498,
        value: 12.49,
        occurredAt: purchase.occurredAt,
        source: purchase.source,
      }),
    );
  });

  it('answers "duplicate" when that invoice line was already applied, so the caller does not credit again', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    const { recordPurchaseMovement } = await import('@/app/lib/services/stock-movements');

    expect(await recordPurchaseMovement(purchase)).toBe('duplicate');
  });

  it('does not swallow another database error', async () => {
    createMock.mockRejectedValue(new Error('mongo went away'));
    const { recordPurchaseMovement } = await import('@/app/lib/services/stock-movements');

    await expect(recordPurchaseMovement(purchase)).rejects.toThrow('mongo went away');
  });
});

describe('deleteMovement / recordAdjustmentMovement', () => {
  it('takes a movement back', async () => {
    const { deleteMovement } = await import('@/app/lib/services/stock-movements');

    await deleteMovement(ING_ID);

    expect(deleteOneMock).toHaveBeenCalledWith({ _id: expect.anything() });
  });

  it('keeps an adjustment as the signed difference, with the balance before and after', async () => {
    const { recordAdjustmentMovement } = await import('@/app/lib/services/stock-movements');

    await recordAdjustmentMovement({
      storeId: STORE_ID,
      rawIngredientId: ING_ID,
      balanceBefore: 5000,
      balanceAfter: 1200,
      note: 'Contagem de estoque',
      userId: 'u1',
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'adjustment',
        quantity: -3800,
        balanceBefore: 5000,
        balanceAfter: 1200,
        note: 'Contagem de estoque',
        createdByUserId: 'u1',
      }),
    );
  });
});

describe('withPriceChanges', () => {
  const item = (over: Record<string, unknown>) =>
    ({ _id: 'x', occurredAt: '2026-08-01T00:00:00Z', quantity: 1, ...over }) as never;

  it('puts each purchase against the previous one (newest first), skipping adjustments', async () => {
    const { withPriceChanges } = await import('@/app/lib/services/stock-movements');

    const result = withPriceChanges([
      item({ _id: 'c', type: 'purchase', unitCost: 3.49 }),
      item({ _id: 'b', type: 'adjustment' }),
      item({ _id: 'a', type: 'purchase', unitCost: 4.89 }),
    ]);

    expect(result[0]?.priceChangePercent).toBeCloseTo(-28.63, 1);
    expect(result[1]?.priceChangePercent).toBeUndefined(); // an adjustment has no price
    expect(result[2]?.priceChangePercent).toBeUndefined(); // the oldest has nothing before it
  });

  it('shows a rise as positive', async () => {
    const { withPriceChanges } = await import('@/app/lib/services/stock-movements');

    const [newest] = withPriceChanges([
      item({ type: 'purchase', unitCost: 5 }),
      item({ type: 'purchase', unitCost: 4 }),
    ]);

    expect(newest?.priceChangePercent).toBeCloseTo(25);
  });
});

describe('listMovementsForIngredient', () => {
  it('lists newest first with the supplier and invoice flattened', async () => {
    leanMock.mockResolvedValue([
      {
        _id: 'm2',
        type: 'purchase',
        occurredAt: new Date('2026-08-11T15:00:00Z'),
        quantity: 5000,
        unitCost: 0.002498,
        value: 12.49,
        source: { supplierName: 'LOJA SANTA MARIA', invoiceNumber: '30892', invoiceSeries: '1' },
      },
      {
        _id: 'm1',
        type: 'adjustment',
        occurredAt: new Date('2026-08-01T10:00:00Z'),
        quantity: -800,
        balanceBefore: 1000,
        balanceAfter: 200,
        note: 'Contagem de estoque',
      },
    ]);
    const { listMovementsForIngredient } = await import('@/app/lib/services/stock-movements');

    const result = await listMovementsForIngredient(ING_ID);

    expect(sortMock).toHaveBeenCalledWith({ occurredAt: -1, _id: -1 });
    expect(result[0]).toMatchObject({
      type: 'purchase',
      supplierName: 'LOJA SANTA MARIA',
      invoiceNumber: '30892',
      occurredAt: '2026-08-11T15:00:00.000Z',
    });
    expect(result[1]).toMatchObject({
      type: 'adjustment',
      balanceBefore: 1000,
      balanceAfter: 200,
      note: 'Contagem de estoque',
    });
    expect(result[1]?.supplierName).toBeUndefined();
  });

  it('is scoped to the ingredient', async () => {
    const { listMovementsForIngredient } = await import('@/app/lib/services/stock-movements');

    await listMovementsForIngredient(ING_ID, 25);

    expect(String(findMock.mock.calls[0][0].rawIngredientId)).toBe(ING_ID);
    expect(limitMock).toHaveBeenCalledWith(25);
  });
});

describe('getSupplierOptionsForStore', () => {
  it('lists distinct suppliers of the store, sorted by name', async () => {
    aggregateMock.mockResolvedValue([
      { _id: '07738069000590', name: 'SUPER ADEGA ATACADISTA' },
      { _id: '27289076001530', name: 'LOJA SANTA MARIA' },
    ]);
    const { getSupplierOptionsForStore } = await import('@/app/lib/services/stock-movements');

    const options = await getSupplierOptionsForStore(STORE_ID);

    expect(options).toEqual([
      { cnpj: '27289076001530', name: 'LOJA SANTA MARIA' },
      { cnpj: '07738069000590', name: 'SUPER ADEGA ATACADISTA' },
    ]);
  });

  it('scopes to the store and to purchases only', async () => {
    const { getSupplierOptionsForStore } = await import('@/app/lib/services/stock-movements');

    await getSupplierOptionsForStore(STORE_ID);

    const pipeline = aggregateMock.mock.calls[0][0];
    expect(String(pipeline[0].$match.storeId)).toBe(STORE_ID);
    expect(pipeline[0].$match.type).toBe('purchase');
  });

  it('falls back to the CNPJ when no name was ever kept, and drops rows with no CNPJ', async () => {
    aggregateMock.mockResolvedValue([
      { _id: '12345678000199', name: undefined },
      { _id: '', name: 'Should be dropped' },
    ]);
    const { getSupplierOptionsForStore } = await import('@/app/lib/services/stock-movements');

    expect(await getSupplierOptionsForStore(STORE_ID)).toEqual([
      { cnpj: '12345678000199', name: '12345678000199' },
    ]);
  });
});

describe('getRawIngredientIdsForSupplier', () => {
  it('returns the ingredient ids ever purchased from that supplier, in this store', async () => {
    distinctMock.mockResolvedValue([ING_ID]);
    const { getRawIngredientIdsForSupplier } = await import('@/app/lib/services/stock-movements');

    const ids = await getRawIngredientIdsForSupplier(STORE_ID, '27289076001530');

    expect(ids).toEqual([ING_ID]);
    const [field, filter] = distinctMock.mock.calls[0];
    expect(field).toBe('rawIngredientId');
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(filter.type).toBe('purchase');
    expect(filter['source.supplierCnpj']).toBe('27289076001530');
  });
});
