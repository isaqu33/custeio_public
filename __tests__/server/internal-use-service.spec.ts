/**
 * @jest-environment node
 */
export {};

// "Consumo interno": stock that left with no sale goes out at the average cost, once per entry, and
// keeps who took it.
const connectDBMock = jest.fn();
const ingredientFindMock = jest.fn();
const ingredientUpdateMock = jest.fn();
const recordMovementMock = jest.fn();
const deleteMovementMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock, updateOne: ingredientUpdateMock },
}));
jest.mock('@/app/models/stock-movements', () => ({ __esModule: true, default: {} }));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordOutflowMovement: recordMovementMock,
  deleteMovement: deleteMovementMock,
}));

const STORE = '665f735a90788d97f5a76322';
const MEAT = '665f735a90788d97f5a76401';
const FRIES = '665f735a90788d97f5a76402';
const REQUEST = '11111111-1111-4111-8111-111111111111';

const ingredients = [
  { _id: MEAT, name: 'Angus 150 g', unit: 'un', averageCost: 6.5 },
  { _id: FRIES, name: 'Batata McCain', unit: 'g', averageCost: 0.02 },
];

// Like the database: only the ingredients that were asked for, and that are in the list.
function found(docs: Array<{ _id: string }>) {
  ingredientFindMock.mockImplementation((query: { _id: { $in: unknown[] } }) => {
    const asked = query._id.$in.map(String);
    return {
      select: () => ({
        lean: () => Promise.resolve(docs.filter((doc) => asked.includes(doc._id))),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  found(ingredients);
  ingredientUpdateMock.mockResolvedValue({});
  recordMovementMock.mockResolvedValue({ id: 'mov1' });
});

describe('registerInternalUse', () => {
  it('takes each line out at its average cost, with who took it, and totals the value', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');

    const result = await registerInternalUse({
      storeId: STORE,
      requestId: REQUEST,
      reason: 'employee',
      personName: '  João   Silva ',
      lines: [
        { rawIngredientId: MEAT, quantity: 2 },
        { rawIngredientId: FRIES, quantity: 300 },
      ],
      userId: 'u1',
    });

    expect(recordMovementMock).toHaveBeenCalledTimes(2);
    expect(recordMovementMock.mock.calls[0][0]).toMatchObject({
      type: 'internal_use',
      storeId: STORE,
      rawIngredientId: MEAT,
      entryId: REQUEST,
      quantity: 2,
      unitCost: 6.5,
      reason: 'employee',
      personName: 'João Silva',
      userId: 'u1',
    });
    expect(ingredientUpdateMock).toHaveBeenCalledTimes(2);
    expect(ingredientUpdateMock.mock.calls[0][1]).toEqual({ $inc: { currentStock: -2 } });
    expect(result.duplicate).toBe(false);
    expect(result.lines.map((line) => line.value)).toEqual([13, 6]);
    expect(result.totalValue).toBe(19);
  });

  it('does not take the stock out again for an entry it already registered', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');
    recordMovementMock.mockResolvedValue('duplicate');

    const result = await registerInternalUse({
      storeId: STORE,
      requestId: REQUEST,
      reason: 'courtesy',
      lines: [{ rawIngredientId: MEAT, quantity: 1 }],
    });

    expect(result.duplicate).toBe(true);
    expect(ingredientUpdateMock).not.toHaveBeenCalled();
  });

  it('takes the ledger row back when the stock move fails', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');
    ingredientUpdateMock.mockRejectedValue(new Error('mongo down'));

    await expect(
      registerInternalUse({
        storeId: STORE,
        requestId: REQUEST,
        reason: 'donation',
        lines: [{ rawIngredientId: MEAT, quantity: 1 }],
      }),
    ).rejects.toThrow('mongo down');

    expect(deleteMovementMock).toHaveBeenCalledWith('mov1');
  });

  it('refuses an ingredient that is not in this store', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');
    found([ingredients[0]!]); // the second id is not found in the store

    await expect(
      registerInternalUse({
        storeId: STORE,
        requestId: REQUEST,
        reason: 'other',
        lines: [
          { rawIngredientId: MEAT, quantity: 1 },
          { rawIngredientId: FRIES, quantity: 1 },
        ],
      }),
    ).rejects.toThrow('Ingredient not found.');
    expect(recordMovementMock).not.toHaveBeenCalled();
  });

  it('asks who took it when the reason is an employee', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');

    await expect(
      registerInternalUse({
        storeId: STORE,
        requestId: REQUEST,
        reason: 'employee',
        personName: '   ',
        lines: [{ rawIngredientId: MEAT, quantity: 1 }],
      }),
    ).rejects.toThrow('Inform who took it.');
    expect(recordMovementMock).not.toHaveBeenCalled();
  });

  it('refuses the same ingredient listed twice', async () => {
    const { registerInternalUse } = await import('@/app/lib/services/internal-use');

    await expect(
      registerInternalUse({
        storeId: STORE,
        requestId: REQUEST,
        reason: 'courtesy',
        lines: [
          { rawIngredientId: MEAT, quantity: 1 },
          { rawIngredientId: MEAT, quantity: 2 },
        ],
      }),
    ).rejects.toThrow('listed twice');
  });
});

describe('registerWaste', () => {
  it('records the loss as a waste outflow, at the average cost, with no person', async () => {
    const { registerWaste } = await import('@/app/lib/services/internal-use');

    const result = await registerWaste({
      storeId: STORE,
      requestId: REQUEST,
      reason: 'expired',
      personName: 'Nobody',
      lines: [{ rawIngredientId: MEAT, quantity: 3 }],
      userId: 'u1',
    });

    expect(recordMovementMock).toHaveBeenCalledTimes(1);
    expect(recordMovementMock.mock.calls[0][0]).toMatchObject({
      type: 'waste',
      rawIngredientId: MEAT,
      quantity: 3,
      unitCost: 6.5,
      reason: 'expired',
    });
    expect(recordMovementMock.mock.calls[0][0].personName).toBeUndefined();
    expect(ingredientUpdateMock.mock.calls[0][1]).toEqual({ $inc: { currentStock: -3 } });
    expect(result.totalValue).toBe(19.5);
  });

  it('does not take the stock out again for an entry it already registered', async () => {
    const { registerWaste } = await import('@/app/lib/services/internal-use');
    recordMovementMock.mockResolvedValue('duplicate');

    const result = await registerWaste({
      storeId: STORE,
      requestId: REQUEST,
      reason: 'breakage',
      lines: [{ rawIngredientId: MEAT, quantity: 1 }],
    });

    expect(result.duplicate).toBe(true);
    expect(ingredientUpdateMock).not.toHaveBeenCalled();
  });
});

describe('monthRange', () => {
  it('starts a month at 03:00 UTC, the PDV local midnight', async () => {
    const { monthRange } = await import('@/app/lib/services/internal-use');

    const range = monthRange('2026-10');
    expect(range.key).toBe('2026-10');
    expect(range.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('rolls over the year and falls back to the current local month', async () => {
    const { monthRange } = await import('@/app/lib/services/internal-use');

    expect(monthRange('2026-12').to.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    // 01:00 UTC on Nov 1st is still October 31st at 22:00 local time.
    expect(monthRange(undefined, new Date('2026-11-01T01:00:00Z')).key).toBe('2026-10');
    expect(monthRange('lixo', new Date('2026-10-09T12:00:00Z')).key).toBe('2026-10');
  });
});

describe('normalizePersonName', () => {
  it('collapses spaces and drops an empty name', async () => {
    const { normalizePersonName } = await import('@/app/lib/services/internal-use');

    expect(normalizePersonName('  Maria   da  Silva ')).toBe('Maria da Silva');
    expect(normalizePersonName('   ')).toBeUndefined();
    expect(normalizePersonName(undefined)).toBeUndefined();
  });
});
