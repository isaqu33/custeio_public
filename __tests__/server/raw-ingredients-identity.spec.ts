/**
 * @jest-environment node
 */
export {};

// Nicknames, barcodes and the purchase pack of an ingredient: cleaned on the way in, and a barcode
// is a key that only one ingredient of a store may hold.
const connectDBMock = jest.fn();
const findByIdLeanMock = jest.fn();
const findOneLeanMock = jest.fn();
const updateLeanMock = jest.fn();
const findByIdAndUpdateMock = jest.fn();
const createMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {}
  class NotFoundError extends HttpError {}
  class ConflictError extends HttpError {}
  return { HttpError, NotFoundError, ConflictError };
});
jest.mock('@/app/lib/services/ingredient-usage', () => ({ getIngredientUsageCounts: jest.fn() }));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordAdjustmentMovement: jest.fn(),
  getRawIngredientIdsForSupplier: jest.fn(),
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: () => ({ lean: findByIdLeanMock }) }),
    findOne: (query: unknown) => ({ select: () => ({ lean: () => findOneLeanMock(query) }) }),
    findByIdAndUpdate: (...args: unknown[]) => {
      findByIdAndUpdateMock(...args);
      return { select: () => ({ lean: updateLeanMock }) };
    },
    create: createMock,
  },
}));

const STORE = '665f735a90788d97f5a76322';
const ID = '665f735a90788d97f5a76401';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  findByIdLeanMock.mockResolvedValue({ _id: ID, storeId: STORE, name: 'Angus 150 g' });
  findOneLeanMock.mockResolvedValue(null);
  updateLeanMock.mockResolvedValue({ _id: ID, storeId: STORE, name: 'Angus 150 g', unit: 'un' });
});

describe('updateRawIngredient — identity', () => {
  it('saves cleaned nicknames and barcodes, never repeating the ingredient name', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({
      id: ID,
      aliases: ['  Carne ', 'carne', 'angus 150 g', 'Blend'],
      barcodes: ['7894 9000 11272', '123'],
    });

    const update = findByIdAndUpdateMock.mock.calls[0][1];
    expect(update.$set.aliases).toEqual(['Carne', 'Blend']);
    expect(update.$set.barcodes).toEqual(['7894900011272']);
    expect(update.$unset).toBeUndefined();
  });

  it('refuses a barcode another ingredient of the store already holds', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');
    findOneLeanMock.mockResolvedValue({ _id: 'other', name: 'Coca Lata' });

    await expect(updateRawIngredient({ id: ID, barcodes: ['7894900011272'] })).rejects.toThrow(
      'already used by "Coca Lata"',
    );
    expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
    // The check is scoped to the store and leaves the ingredient itself out.
    expect(findOneLeanMock.mock.calls[0][0]).toMatchObject({
      barcodes: { $in: ['7894900011272'] },
    });
  });

  it('keeps a pack, and takes it away with null', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: ID, purchasePack: { label: 'Fardo 12 un', quantity: 12 } });
    expect(findByIdAndUpdateMock.mock.calls[0][1].$set.purchasePack).toEqual({
      label: 'Fardo 12 un',
      quantity: 12,
    });

    await updateRawIngredient({ id: ID, purchasePack: null });
    const second = findByIdAndUpdateMock.mock.calls[1][1];
    expect(second.$set.purchasePack).toBeUndefined();
    expect(second.$unset).toEqual({ purchasePack: '' });
  });

  it('does not look the ingredient up when no identity field is sent', async () => {
    const { updateRawIngredient } = await import('@/app/lib/services/raw-ingredients');

    await updateRawIngredient({ id: ID, minAlertStock: 5 });

    expect(findByIdLeanMock).not.toHaveBeenCalled();
    expect(findByIdAndUpdateMock.mock.calls[0][1].$set.aliases).toBeUndefined();
  });
});

describe('createRawIngredientForStore — identity', () => {
  it('stores the cleaned identity with the new ingredient', async () => {
    const { createRawIngredientForStore } = await import('@/app/lib/services/raw-ingredients');
    createMock.mockResolvedValue({
      toObject: () => ({ _id: ID, storeId: STORE, name: 'Bacon', unit: 'g', currentStock: 0 }),
    });

    await createRawIngredientForStore({
      storeId: STORE,
      name: 'Bacon',
      unit: 'g',
      aliases: ['bacon fatiado', 'Bacon'],
      barcodes: ['78910000000017'],
      purchasePack: { quantity: 1000 },
    });

    expect(createMock.mock.calls[0][0]).toMatchObject({
      aliases: ['bacon fatiado'],
      barcodes: ['78910000000017'],
      purchasePack: { quantity: 1000 },
    });
  });
});
