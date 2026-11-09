/**
 * @jest-environment node
 */
export {};

// Merging ingredients must also repoint the recipes of the kitchen's preparations.
const ingredientFindMock = jest.fn();
const ingredientUpdateOneMock = jest.fn();

const lean = (value: unknown) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.lean = () => Promise.resolve(value);
  return q;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: { find: () => lean([]), updateOne: jest.fn() },
}));
jest.mock('@/app/models/product-recipes', () => ({
  __esModule: true,
  default: { find: () => lean([]), updateOne: jest.fn() },
}));
jest.mock('@/app/models/supplier-item-mappings', () => ({
  __esModule: true,
  default: { updateMany: jest.fn() },
}));
jest.mock('@/app/models/stock-movements', () => ({
  __esModule: true,
  default: { aggregate: () => Promise.resolve([]), updateMany: jest.fn() },
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: {
    find: ingredientFindMock,
    updateOne: ingredientUpdateOneMock,
    updateMany: jest.fn(),
    findOneAndUpdate: () => lean({ _id: 'a', name: 'Cebola Uniao Kg' }),
    deleteMany: jest.fn(),
  },
}));

const STORE = '665f735a90788d97f5a76322';
const TARGET = '665f735a90788d97f5a76391';
const SOURCE = '665f735a90788d97f5a76392';
const OTHER = '665f735a90788d97f5a76393';
const PREP = '665f735a90788d97f5a76394';

describe('mergeRawIngredients and preparations', () => {
  it('points a preparation recipe line at the surviving ingredient', async () => {
    const docs = [
      { _id: TARGET, unit: 'g', currentStock: 100, averageCost: 0.01 },
      { _id: SOURCE, unit: 'g', currentStock: 50, averageCost: 0.02 },
    ];
    ingredientFindMock.mockImplementation((filter: Record<string, unknown>) =>
      'preparation.lines.rawIngredientId' in filter
        ? lean([
            {
              _id: PREP,
              preparation: {
                lines: [
                  { rawIngredientId: OTHER, quantity: 1143 },
                  { rawIngredientId: SOURCE, quantity: 75 },
                ],
              },
            },
          ])
        : lean(docs),
    );
    const { mergeRawIngredients } = await import('@/app/lib/services/ingredient-merge');

    await mergeRawIngredients({ storeId: STORE, targetId: TARGET, sourceIds: [SOURCE] });

    const update = ingredientUpdateOneMock.mock.calls.find((call) => call[0]._id === PREP)?.[1] as {
      $set: { 'preparation.lines': Array<{ rawIngredientId: unknown; quantity: number }> };
    };
    expect(
      update.$set['preparation.lines'].map((l) => [String(l.rawIngredientId), l.quantity]),
    ).toEqual([
      [OTHER, 1143],
      [TARGET, 75],
    ]);
  });
});
