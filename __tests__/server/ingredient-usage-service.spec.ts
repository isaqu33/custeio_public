/**
 * @jest-environment node
 */
export {};

// "Is this ingredient part of what the store sells?" — how many ACTIVE products
// use it, counting the product's own recipe and its complements'.
const connectDBMock = jest.fn();
const findMock = jest.fn();
const selectMock = jest.fn();
const leanMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: { find: findMock },
}));

const loadSharedRecipesMock = jest.fn();
jest.mock('@/app/lib/services/shared-recipes', () => ({
  loadSharedRecipes: loadSharedRecipesMock,
}));

const STORE_ID = '665f735a90788d97f5a76322';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  findMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ lean: leanMock });
  leanMock.mockResolvedValue([]);
  loadSharedRecipesMock.mockResolvedValue(new Map());
});

describe('getIngredientUsageCounts', () => {
  it('counts a product once however many lines mention the ingredient, and its complements too', async () => {
    leanMock.mockResolvedValue([
      {
        recipe: [
          { rawIngredientId: 'cheese' },
          { rawIngredientId: 'cheese' },
          { rawIngredientId: 'beef' },
        ],
        modifiers: [
          { recipe: [{ rawIngredientId: 'cheese' }] },
          { recipe: [{ rawIngredientId: 'bacon' }] },
        ],
      },
      { recipe: [{ rawIngredientId: 'cheese' }], modifiers: [] },
      { recipe: [], modifiers: [] },
    ]);
    const { getIngredientUsageCounts } = await import('@/app/lib/services/ingredient-usage');

    const counts = await getIngredientUsageCounts(STORE_ID);

    expect(counts.get('cheese')).toBe(2); // two products
    expect(counts.get('beef')).toBe(1);
    expect(counts.get('bacon')).toBe(1); // only in a complement's recipe
    expect(counts.has('sugar')).toBe(false); // nobody uses it
  });

  it("uses the recipe saved by PDV code instead of the row's own, for products and complements", async () => {
    leanMock.mockResolvedValue([
      {
        codPdv: '218',
        recipe: [{ rawIngredientId: 'stale' }],
        modifiers: [{ codPdv: '806', recipe: [] }],
      },
    ]);
    loadSharedRecipesMock.mockImplementation(async (_store: string, kind: string) =>
      kind === 'product'
        ? new Map([['218', [{ rawIngredientId: 'beef' }]]])
        : new Map([['806', [{ rawIngredientId: 'patty' }]]]),
    );
    const { getIngredientUsageCounts } = await import('@/app/lib/services/ingredient-usage');

    const counts = await getIngredientUsageCounts(STORE_ID);

    expect(counts.get('beef')).toBe(1);
    expect(counts.get('patty')).toBe(1);
    expect(counts.has('stale')).toBe(false);
  });

  it('only looks at the active products of the store', async () => {
    const { getIngredientUsageCounts } = await import('@/app/lib/services/ingredient-usage');

    await getIngredientUsageCounts(STORE_ID);

    const filter = findMock.mock.calls[0][0];
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(filter.isActive).toBe(true);
  });

  it('is empty for a store with no recipes', async () => {
    leanMock.mockResolvedValue([{ recipe: undefined, modifiers: undefined }]);
    const { getIngredientUsageCounts } = await import('@/app/lib/services/ingredient-usage');

    expect((await getIngredientUsageCounts(STORE_ID)).size).toBe(0);
  });
});
