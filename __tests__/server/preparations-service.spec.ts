/**
 * @jest-environment node
 */
export {};

// savePreparation: what it stores, and the density it works out from the recipe.
const findByIdLeanMock = jest.fn();
const findLeanMock = jest.fn();
const updateOneMock = jest.fn();

const chain = (lean: jest.Mock) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.lean = lean;
  return q;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/lib/services/raw-ingredients', () => ({ creditRawIngredientPurchase: jest.fn() }));
jest.mock('@/app/lib/services/stock-movements', () => ({
  deleteMovement: jest.fn(),
  recordProductionMovement: jest.fn(),
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: {
    findById: () => chain(findByIdLeanMock),
    find: () => chain(findLeanMock),
    updateOne: updateOneMock,
  },
}));

const STORE = '665f735a90788d97f5a76322';
const PREP = '665f735a90788d97f5a76390';
const A = '665f735a90788d97f5a76391';
const B = '665f735a90788d97f5a76392';

beforeEach(() => {
  jest.clearAllMocks();
  findLeanMock.mockResolvedValue([
    { _id: A, unit: 'g' },
    { _id: B, unit: 'ml' },
  ]);
  updateOneMock.mockResolvedValue({});
});

const lines = [
  { rawIngredientId: A, quantity: 1150 },
  { rawIngredientId: B, quantity: 0.75 },
];

describe('savePreparation density', () => {
  it('stores the density worked out from a recipe that crosses units', async () => {
    findByIdLeanMock.mockResolvedValue({ _id: PREP, storeId: STORE, unit: 'ml' });
    const { savePreparation } = await import('@/app/lib/services/preparations');

    await savePreparation({ id: PREP, yield: 1000, lines });

    expect(updateOneMock.mock.calls[0][1].$set.density).toEqual({
      gramsPerMl: 1.15,
      source: 'derived',
    });
  });

  it("never overwrites the owner's own density", async () => {
    findByIdLeanMock.mockResolvedValue({
      _id: PREP,
      storeId: STORE,
      unit: 'ml',
      density: { gramsPerMl: 1.2, source: 'manual' },
    });
    const { savePreparation } = await import('@/app/lib/services/preparations');

    await savePreparation({ id: PREP, yield: 1000, lines });

    expect(updateOneMock.mock.calls[0][1].$set.density).toBeUndefined();
  });
});
