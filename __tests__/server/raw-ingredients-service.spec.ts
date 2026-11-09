/**
 * @jest-environment node
 */
export {};

// The Estoque page's data layer: manual stock/CMV baseline per store, ahead of
// the sefaz.nfe.received/pos.order.received jobs that will roll these forward
// automatically once they exist (see docs/features/stock-and-cmv.md).
const connectDBMock = jest.fn();

const findSelectMock = jest.fn();
const findSortMock = jest.fn();
const findLeanMock = jest.fn();
const findMock = jest.fn();

const findByIdSelectMock = jest.fn();
const findByIdLeanMock = jest.fn();
const findByIdMock = jest.fn();

const createMock = jest.fn();
const getUsageMock = jest.fn();
const recordAdjustmentMock = jest.fn();
const getIdsForSupplierMock = jest.fn();
const countDocumentsMock = jest.fn();
const updateManyMock = jest.fn();
const aggregateMock = jest.fn();
const existsMock = jest.fn();

const findOneAndUpdateSelectMock = jest.fn();
const findOneAndUpdateLeanMock = jest.fn();
const findOneAndUpdateMock = jest.fn();

const findByIdAndUpdateSelectMock = jest.fn();
const findByIdAndUpdateLeanMock = jest.fn();
const findByIdAndUpdateMock = jest.fn();

jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  class NotFoundError extends HttpError {
    constructor(message = 'Not found.') {
      super(404, message);
      this.name = 'NotFoundError';
    }
  }
  class ConflictError extends HttpError {
    constructor(message = 'Conflict.') {
      super(409, message);
      this.name = 'ConflictError';
    }
  }
  return { HttpError, NotFoundError, ConflictError };
});
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/services/ingredient-usage', () => ({
  getIngredientUsageCounts: getUsageMock,
  // What the lists use to tell an unreviewed draft from one a recipe already uses.
  getIngredientIdsInRecipes: async (...args: unknown[]) =>
    new Set((await getUsageMock(...args)).keys()),
}));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordAdjustmentMovement: recordAdjustmentMock,
  getRawIngredientIdsForSupplier: getIdsForSupplierMock,
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: {
    find: findMock,
    findById: findByIdMock,
    create: createMock,
    findByIdAndUpdate: findByIdAndUpdateMock,
    findOneAndUpdate: findOneAndUpdateMock,
    countDocuments: countDocumentsMock,
    updateMany: updateManyMock,
    aggregate: aggregateMock,
    exists: existsMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const INGREDIENT_ID = '665f735a90788d97f5a76399';

function ingredientDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: INGREDIENT_ID,
    storeId: STORE_ID,
    name: 'Queijo mussarela',
    unit: 'g',
    currentStock: 1000,
    averageCost: 0.05,
    minAlertStock: 200,
    createdAt: new Date('2026-09-20T00:00:00Z'),
    ...overrides,
  };
}

function isDuplicateKeyError() {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);

  findSelectMock.mockReturnValue({ sort: findSortMock });
  findSortMock.mockReturnValue({ lean: findLeanMock });
  findMock.mockReturnValue({ select: findSelectMock });
  findLeanMock.mockResolvedValue([ingredientDoc()]);

  findByIdSelectMock.mockReturnValue({ lean: findByIdLeanMock });
  findByIdMock.mockReturnValue({ select: findByIdSelectMock });
  findByIdLeanMock.mockResolvedValue({ storeId: STORE_ID });

  createMock.mockResolvedValue({ toObject: () => ingredientDoc() });

  findByIdAndUpdateSelectMock.mockReturnValue({ lean: findByIdAndUpdateLeanMock });
  findByIdAndUpdateMock.mockReturnValue({ select: findByIdAndUpdateSelectMock });
  findByIdAndUpdateLeanMock.mockResolvedValue(ingredientDoc());

  findOneAndUpdateSelectMock.mockReturnValue({ lean: findOneAndUpdateLeanMock });
  findOneAndUpdateMock.mockReturnValue({ select: findOneAndUpdateSelectMock });
  findOneAndUpdateLeanMock.mockResolvedValue(ingredientDoc());
  countDocumentsMock.mockResolvedValue(1);
  getUsageMock.mockResolvedValue(new Map());
  recordAdjustmentMock.mockResolvedValue(undefined);
  getIdsForSupplierMock.mockResolvedValue([]);
  aggregateMock.mockResolvedValue([]);
  existsMock.mockResolvedValue(null);
});

describe('getRawIngredientsForStore', () => {
  it('lists a store’s ingredients sorted by name', async () => {
    const { getRawIngredientsForStore } = await import('@/app/lib/services/raw-ingredients');

    const result = await getRawIngredientsForStore(STORE_ID);

    expect(findMock).toHaveBeenCalledWith({ storeId: expect.objectContaining({}) });
    expect(findSortMock).toHaveBeenCalledWith({ name: 1 });
    expect(result).toEqual([
      expect.objectContaining({ _id: INGREDIENT_ID, name: 'Queijo mussarela', unit: 'g' }),
    ]);
  });
});

describe('getRawIngredientsPageForStore', () => {
  const limitMock = jest.fn();
  const skipMock = jest.fn();

  beforeEach(() => {
    findSortMock.mockReturnValue({ skip: skipMock });
    skipMock.mockReturnValue({ limit: limitMock });
    limitMock.mockReturnValue({ lean: findLeanMock });
  });

  it('paginates newest first and reports the total and page count', async () => {
    countDocumentsMock.mockResolvedValue(45);
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    const result = await getRawIngredientsPageForStore(STORE_ID, { page: 3, limit: 20 });

    expect(findSortMock).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(skipMock).toHaveBeenCalledWith(40);
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(result).toMatchObject({ total: 45, page: 3, totalPages: 3 });
    expect(result.data).toHaveLength(1);
  });

  it('sums the family stock only when every variation is in the main unit', async () => {
    findLeanMock.mockResolvedValue([ingredientDoc({ currentStock: 5, unit: 'g' })]);
    aggregateMock.mockResolvedValueOnce([{ _id: INGREDIENT_ID, n: 2, stock: 100, units: ['g'] }]);
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    const summed = await getRawIngredientsPageForStore(STORE_ID);

    expect(summed.data[0]).toMatchObject({ variantCount: 2, familyStock: 105 });

    aggregateMock.mockResolvedValueOnce([
      { _id: INGREDIENT_ID, n: 2, stock: 100, units: ['g', 'un'] },
    ]);
    const mixed = await getRawIngredientsPageForStore(STORE_ID);

    expect(mixed.data[0]?.familyStock).toBeUndefined();
  });

  it('narrows by a search on the name, a nickname or a barcode, escaping regex characters', async () => {
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { q: ' (queijo ' });

    const query = findMock.mock.calls[0][0];
    const condition = { $regex: '\\(queijo', $options: 'i' };
    expect(query.$or).toEqual([
      { name: condition },
      { aliases: condition },
      { barcodes: condition },
    ]);
    expect(countDocumentsMock).toHaveBeenCalledWith(query);
  });

  it('does not filter by name when there is no search term', async () => {
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { q: '   ' });

    expect(findMock.mock.calls[0][0]).not.toHaveProperty('name');
  });

  it('narrows by kind', async () => {
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { kind: 'cleaning' });
    await getRawIngredientsPageForStore(STORE_ID, { kind: 'all' });

    expect(findMock.mock.calls[0][0].kind).toBe('cleaning');
    expect(findMock.mock.calls[1][0]).not.toHaveProperty('kind');
  });

  it('narrows to what recipes use, or to what nobody uses', async () => {
    const used = '665f735a90788d97f5a76a01';
    getUsageMock.mockResolvedValue(new Map([[used, 2]]));
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { usage: 'used' });
    await getRawIngredientsPageForStore(STORE_ID, { usage: 'unused' });
    await getRawIngredientsPageForStore(STORE_ID, { usage: 'all' });

    expect(findMock.mock.calls[0][0]._id.$in.map(String)).toEqual([used]);
    expect(findMock.mock.calls[1][0]._id.$nin.map(String)).toEqual([used]);
    expect(findMock.mock.calls[2][0]).not.toHaveProperty('_id');
  });

  it('does not resolve a supplier when none is selected', async () => {
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { supplier: 'all' });
    await getRawIngredientsPageForStore(STORE_ID);

    expect(getIdsForSupplierMock).not.toHaveBeenCalled();
  });

  it('narrows to what one supplier was ever bought from', async () => {
    getIdsForSupplierMock.mockResolvedValue([INGREDIENT_ID]);
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { supplier: '27289076001530' });

    expect(getIdsForSupplierMock).toHaveBeenCalledWith(STORE_ID, '27289076001530');
    expect(findMock.mock.calls[0][0]._id.$in.map(String)).toEqual([INGREDIENT_ID]);
  });

  it('combines the usage and supplier filters (both narrow by _id) with $and, instead of one winning over the other', async () => {
    const used = '665f735a90788d97f5a76a01';
    getUsageMock.mockResolvedValue(new Map([[used, 2]]));
    getIdsForSupplierMock.mockResolvedValue([INGREDIENT_ID]);
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    await getRawIngredientsPageForStore(STORE_ID, { usage: 'used', supplier: '27289076001530' });

    const query = findMock.mock.calls[0][0];
    expect(query).not.toHaveProperty('_id');
    expect(query.$and).toEqual([
      { _id: { $in: [expect.objectContaining({})] } },
      { _id: { $in: [expect.objectContaining({})] } },
    ]);
  });

  it('says how many active products use each ingredient on the page', async () => {
    getUsageMock.mockResolvedValue(new Map([[INGREDIENT_ID, 3]]));
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    const { data } = await getRawIngredientsPageForStore(STORE_ID);

    expect(data[0]?.usedInProducts).toBe(3);
  });

  it('maps the last purchase and the kind onto the row', async () => {
    findLeanMock.mockResolvedValue([
      ingredientDoc({
        kind: 'packaging',
        lastPurchase: {
          at: new Date('2026-08-11T12:00:00Z'),
          supplierName: 'LOJA SANTA MARIA',
          supplierCnpj: '27289076001530',
          invoiceNumber: '30892',
          quantity: 5000,
          unitCost: 0.002498,
        },
      }),
    ]);
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    const [row] = (await getRawIngredientsPageForStore(STORE_ID)).data;

    expect(row).toMatchObject({
      kind: 'packaging',
      lastPurchase: {
        at: '2026-08-11T12:00:00.000Z',
        supplierName: 'LOJA SANTA MARIA',
        invoiceNumber: '30892',
        unitCost: 0.002498,
      },
    });
  });

  it('defaults kind to food and has no last purchase for a row that never had one', async () => {
    const { getRawIngredientsPageForStore } = await import('@/app/lib/services/raw-ingredients');

    const [row] = (await getRawIngredientsPageForStore(STORE_ID)).data;

    expect(row?.kind).toBe('food');
    expect(row?.lastPurchase).toBeUndefined();
  });
});

describe('creditRawIngredientPurchase', () => {
  it('runs the weighted-average update as an aggregation pipeline', async () => {
    const { creditRawIngredientPurchase } = await import('@/app/lib/services/raw-ingredients');

    const result = await creditRawIngredientPurchase(INGREDIENT_ID, {
      convertedQuantity: 500,
      lineValue: 25,
    });

    const [filter, update, options] = findOneAndUpdateMock.mock.calls[0];
    expect(filter).toEqual({ _id: expect.objectContaining({}) });
    // Mongoose 9 rejects an array update unless `updatePipeline` is set — the
    // regression that made every NFe line fail in the worker.
    expect(Array.isArray(update)).toBe(true);
    expect(options).toEqual({ returnDocument: 'after', updatePipeline: true });
    expect(result).toMatchObject({ _id: INGREDIENT_ID });
  });

  it('throws NotFoundError when the ingredient does not exist', async () => {
    findOneAndUpdateLeanMock.mockResolvedValue(null);
    const { creditRawIngredientPurchase } = await import('@/app/lib/services/raw-ingredients');

    await expect(
      creditRawIngredientPurchase(INGREDIENT_ID, { convertedQuantity: 1, lineValue: 1 }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('creditRawIngredientPurchase — cost and last purchase', () => {
  const pipeline = async (purchase?: Record<string, unknown>) => {
    const { creditRawIngredientPurchase } = await import('@/app/lib/services/raw-ingredients');
    await creditRawIngredientPurchase(INGREDIENT_ID, {
      convertedQuantity: 5000,
      lineValue: 12.49,
      ...(purchase && { purchase: purchase as never }),
    });
    return findOneAndUpdateMock.mock.calls[0][1][0].$set;
  };

  it('rounds the weighted average to 8 decimals, against float dust', async () => {
    const set = await pipeline();

    expect(set.averageCost.$cond[1].$round[1]).toBe(8);
  });

  it('only weighs the stock actually on hand: a negative balance carries no cost', async () => {
    const set = await pipeline();

    const divide = set.averageCost.$cond[1].$round[0].$divide;
    // (max(0, currentStock) × averageCost + value) / (max(0, currentStock) + quantity)
    expect(JSON.stringify(divide)).toContain('{"$max":[0,"$currentStock"]}');
    // ...while the balance itself still moves by the full quantity.
    expect(set.currentStock).toEqual({ $add: ['$currentStock', 5000] });
  });

  it('keeps the last purchase only when it is newer than the one already there', async () => {
    const at = new Date('2026-08-11T12:00:00Z');
    const set = await pipeline({
      at,
      supplierCnpj: '27289076001530',
      supplierName: 'LOJA SANTA MARIA',
      invoiceNumber: '30892',
    });

    const [condition, replacement, keep] = set.lastPurchase.$cond;
    expect(condition).toEqual({ $gt: [at, { $ifNull: ['$lastPurchase.at', new Date(0)] }] });
    expect(replacement).toMatchObject({ at, quantity: 5000, unitCost: 0.002498 });
    expect(keep).toBe('$lastPurchase');
  });

  it('never lets a supplier name be read as a field path', async () => {
    const set = await pipeline({
      at: new Date(),
      supplierCnpj: '1',
      supplierName: '$currentStock',
      invoiceNumber: '$x',
    });

    const replacement = set.lastPurchase.$cond[1];
    expect(replacement.supplierName).toEqual({ $literal: '$currentStock' });
    expect(replacement.invoiceNumber).toEqual({ $literal: '$x' });
  });

  it('does not touch lastPurchase when no invoice is given', async () => {
    const set = await pipeline();

    expect(set).not.toHaveProperty('lastPurchase');
  });
});

describe('countRawIngredientStock', () => {
  beforeEach(() => {
    findByIdAndUpdateLeanMock.mockResolvedValue({ storeId: STORE_ID, currentStock: 5000 });
    findByIdSelectMock.mockReturnValue({ lean: findByIdLeanMock });
    findByIdLeanMock.mockResolvedValue(ingredientDoc({ currentStock: 1200 }));
  });

  it('sets the balance to what was counted and keeps the difference in the ledger', async () => {
    const { countRawIngredientStock } = await import('@/app/lib/services/raw-ingredients');

    const result = await countRawIngredientStock({
      id: INGREDIENT_ID,
      countedStock: 1200,
      userId: 'u1',
    });

    expect(findByIdAndUpdateMock.mock.calls[0][1]).toEqual({ $set: { currentStock: 1200 } });
    expect(findByIdAndUpdateMock.mock.calls[0][2]).toEqual({ returnDocument: 'before' });
    expect(recordAdjustmentMock).toHaveBeenCalledWith({
      storeId: STORE_ID,
      rawIngredientId: INGREDIENT_ID,
      balanceBefore: 5000,
      balanceAfter: 1200,
      note: 'Contagem de estoque',
      userId: 'u1',
    });
    expect(result.currentStock).toBe(1200);
  });

  it('keeps the note the owner wrote', async () => {
    const { countRawIngredientStock } = await import('@/app/lib/services/raw-ingredients');

    await countRawIngredientStock({
      id: INGREDIENT_ID,
      countedStock: 0,
      note: '  inventário de setembro ',
    });

    expect(recordAdjustmentMock.mock.calls[0][0].note).toBe('inventário de setembro');
  });

  it('404s for an unknown ingredient, without writing to the ledger', async () => {
    findByIdAndUpdateLeanMock.mockResolvedValue(null);
    const { countRawIngredientStock } = await import('@/app/lib/services/raw-ingredients');

    await expect(
      countRawIngredientStock({ id: INGREDIENT_ID, countedStock: 1 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(recordAdjustmentMock).not.toHaveBeenCalled();
  });
});

describe('getRawIngredientStoreId', () => {
  it('resolves the owning store of an ingredient', async () => {
    const { getRawIngredientStoreId } = await import('@/app/lib/services/raw-ingredients');

    expect(await getRawIngredientStoreId(INGREDIENT_ID)).toBe(STORE_ID);
  });

  it('returns null for an unknown ingredient', async () => {
    findByIdLeanMock.mockResolvedValue(null);
    const { getRawIngredientStoreId } = await import('@/app/lib/services/raw-ingredients');

    expect(await getRawIngredientStoreId(INGREDIENT_ID)).toBeNull();
  });
});

describe('createRawIngredientForStore', () => {
  const input = { storeId: STORE_ID, name: 'Queijo mussarela', unit: 'g' as const };

  it('creates an ingredient with the manual baseline defaulted to zero', async () => {
    createMock.mockResolvedValue({ toObject: () => ingredientDoc({ currentStock: 0 }) });
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    const result = await createRawIngredientForStore(input);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Queijo mussarela',
        unit: 'g',
        currentStock: 0,
        averageCost: 0,
        minAlertStock: 0,
        kind: 'food',
      }),
    );
    expect(result.name).toBe('Queijo mussarela');
    expect(recordAdjustmentMock).not.toHaveBeenCalled();
  });

  it('marks a preparation made in the kitchen', async () => {
    createMock.mockResolvedValue({ toObject: () => ingredientDoc({ currentStock: 0 }) });
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await createRawIngredientForStore({ ...input, isPreparation: true });
    await createRawIngredientForStore(input);

    expect(createMock.mock.calls[0][0].isPreparation).toBe(true);
    expect(createMock.mock.calls[1][0].isPreparation).toBeUndefined();
  });

  it('puts a balance typed into the form on the ledger as the initial balance', async () => {
    createMock.mockResolvedValue({ toObject: () => ingredientDoc({ currentStock: 500 }) });
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await createRawIngredientForStore({ ...input, currentStock: 500, userId: 'u1' });

    expect(recordAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceBefore: 0,
        balanceAfter: 500,
        note: 'Saldo inicial',
        userId: 'u1',
      }),
    );
  });

  it('creates with the given kind', async () => {
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await createRawIngredientForStore({ ...input, kind: 'cleaning' });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleaning' }));
  });

  it('keeps a caller-supplied baseline instead of defaulting it', async () => {
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await createRawIngredientForStore({ ...input, currentStock: 500, averageCost: 0.1 });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentStock: 500, averageCost: 0.1 }),
    );
  });

  it('turns a duplicate (storeId, name) into a conflict, not a 500', async () => {
    createMock.mockRejectedValue(isDuplicateKeyError());
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await expect(createRawIngredientForStore(input)).rejects.toMatchObject({ status: 409 });
  });

  it('does not swallow an unexpected database error', async () => {
    createMock.mockRejectedValue(new Error('mongo went away'));
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');

    await expect(createRawIngredientForStore(input)).rejects.toThrow('mongo went away');
  });
});

describe('updateRawIngredient', () => {
  it('only sends the fields the caller actually provided, plus clearing the draft flag', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, currentStock: 750 });

    expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { currentStock: 750, isDraft: false } },
      { returnDocument: 'after' },
    );
  });

  it('rounds what it stores, so float dust never reaches the database', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({
      id: INGREDIENT_ID,
      averageCost: 0.0024980000000000002,
      currentStock: 4999.9999999,
    });

    const [, update] = findByIdAndUpdateMock.mock.calls[0];
    expect(update.$set.averageCost).toBe(0.002498);
    expect(update.$set.currentStock).toBe(5000);
  });

  it('keeps a manual balance change in the ledger, with before and after', async () => {
    findByIdSelectMock.mockReturnValue({ lean: findByIdLeanMock });
    findByIdLeanMock.mockResolvedValue({ storeId: STORE_ID, currentStock: 1000 });
    findByIdAndUpdateLeanMock.mockResolvedValue(ingredientDoc({ currentStock: 750 }));
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, currentStock: 750, userId: 'u1' });

    expect(recordAdjustmentMock).toHaveBeenCalledWith({
      storeId: STORE_ID,
      rawIngredientId: INGREDIENT_ID,
      balanceBefore: 1000,
      balanceAfter: 750,
      note: 'Edição manual',
      userId: 'u1',
    });
  });

  it('does not write to the ledger when the balance did not change', async () => {
    findByIdSelectMock.mockReturnValue({ lean: findByIdLeanMock });
    findByIdLeanMock.mockResolvedValue({ storeId: STORE_ID, currentStock: 1000 });
    findByIdAndUpdateLeanMock.mockResolvedValue(ingredientDoc({ currentStock: 1000 }));
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, currentStock: 1000 });
    await updateRawIngredient({ id: INGREDIENT_ID, name: 'Só o nome' });

    expect(recordAdjustmentMock).not.toHaveBeenCalled();
  });

  it('changes the kind', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, kind: 'cleaning' });

    expect(findByIdAndUpdateMock.mock.calls[0][1].$set.kind).toBe('cleaning');
  });

  it('throws not-found for a missing ingredient', async () => {
    findByIdAndUpdateLeanMock.mockResolvedValue(null);
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await expect(updateRawIngredient({ id: INGREDIENT_ID, name: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('turns a rename collision into a conflict', async () => {
    findByIdAndUpdateLeanMock.mockRejectedValue(isDuplicateKeyError());
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await expect(
      updateRawIngredient({ id: INGREDIENT_ID, name: 'Already taken' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('updateRawIngredient — family', () => {
  const MAIN_ID = '665f735a90788d97f5a76398';

  it('groups an ingredient under a main one of the same store', async () => {
    findByIdLeanMock.mockResolvedValue({ storeId: STORE_ID });
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, familyOf: MAIN_ID });

    expect(String(findByIdAndUpdateMock.mock.calls[0][1].$set.familyOf)).toBe(MAIN_ID);
  });

  it('takes it out of the family with null', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, familyOf: null });

    expect(findByIdAndUpdateMock.mock.calls[0][1].$unset).toEqual({ familyOf: '' });
  });

  it('stores the density the owner typed as manual, and takes it away with null', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: INGREDIENT_ID, gramsPerMl: 1.15 });
    await updateRawIngredient({ id: INGREDIENT_ID, gramsPerMl: null });

    expect(findByIdAndUpdateMock.mock.calls[0][1].$set.density).toEqual({
      gramsPerMl: 1.15,
      source: 'manual',
    });
    expect(findByIdAndUpdateMock.mock.calls[1][1].$unset).toEqual({ density: '' });
  });

  it('refuses itself, a main from another store, a main that is a variation, and one with variations', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await expect(
      updateRawIngredient({ id: INGREDIENT_ID, familyOf: INGREDIENT_ID }),
    ).rejects.toMatchObject({ status: 409 });

    findByIdLeanMock
      .mockResolvedValueOnce({ storeId: STORE_ID })
      .mockResolvedValueOnce({ storeId: 'other-store' });
    await expect(
      updateRawIngredient({ id: INGREDIENT_ID, familyOf: MAIN_ID }),
    ).rejects.toMatchObject({ status: 409 });

    findByIdLeanMock
      .mockResolvedValueOnce({ storeId: STORE_ID })
      .mockResolvedValueOnce({ storeId: STORE_ID, familyOf: 'x' });
    await expect(
      updateRawIngredient({ id: INGREDIENT_ID, familyOf: MAIN_ID }),
    ).rejects.toMatchObject({ status: 409 });

    findByIdLeanMock.mockResolvedValue({ storeId: STORE_ID });
    existsMock.mockResolvedValueOnce({ _id: 'v' });
    await expect(
      updateRawIngredient({ id: INGREDIENT_ID, familyOf: MAIN_ID }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('setInOperationForStore', () => {
  it('sets only `inOperation` on the picked ids of the store', async () => {
    updateManyMock.mockResolvedValue({ modifiedCount: 2 });
    const { setInOperationForStore } = await import('@/app/lib/services/raw-ingredients');

    const changed = await setInOperationForStore({
      storeId: STORE_ID,
      inOperation: false,
      ids: [INGREDIENT_ID, '665f735a90788d97f5a76398'],
    });

    expect(changed).toBe(2);
    const [filter, update] = updateManyMock.mock.calls[0];
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(filter._id.$in).toHaveLength(2);
    expect(update).toEqual({ $set: { inOperation: false } });
  });

  it('applies to a whole list with the same narrowing as the table, leaving preparations out', async () => {
    updateManyMock.mockResolvedValue({ modifiedCount: 120 });
    getUsageMock.mockResolvedValue(new Map());
    const { setInOperationForStore } = await import('@/app/lib/services/raw-ingredients');

    const changed = await setInOperationForStore({
      storeId: STORE_ID,
      inOperation: false,
      filters: { group: 'review', q: 'uva' },
    });

    expect(changed).toBe(120);
    const filter = updateManyMock.mock.calls[0][0];
    const text = JSON.stringify(filter);
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(text).toContain('"isDraft":true'); // the "A confirmar" group
    expect(text).toContain('preparation.lines.0'); // preparations excluded
    expect(text).toContain('uva'); // the search
  });
});
