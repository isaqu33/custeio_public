/**
 * @jest-environment node
 */
export {};

// The Complementos screen: add-ons grouped by PDV code, with the recipe saved under that
// code. "Configured but empty" (consumes nothing) is not the same as "no recipe yet".
const connectDBMock = jest.fn();
const aggregateMock = jest.fn();
const ingredientFindMock = jest.fn();
const ingredientCountMock = jest.fn();
const loadSharedMock = jest.fn();
const saveSharedMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/errors', () => ({
  UnprocessableEntityError: class extends Error {},
}));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: { aggregate: aggregateMock },
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock, countDocuments: ingredientCountMock },
}));
jest.mock('@/app/lib/services/shared-recipes', () => ({
  loadSharedRecipes: loadSharedMock,
  saveSharedRecipe: saveSharedMock,
}));
jest.mock('@/app/lib/services/products', () => ({
  computeProductEconomics: (
    _price: number,
    lines: Array<{ quantity: number; averageCost?: number }>,
  ) =>
    lines.length === 0
      ? { costIncomplete: false }
      : {
          cost: lines.reduce((sum, line) => sum + line.quantity * (line.averageCost ?? 0), 0),
          costIncomplete: lines.some((line) => !line.averageCost),
        },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const PATTY = '665f735a90788d97f5a76a01';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  ingredientFindMock.mockReturnValue({
    select: () => ({
      lean: () =>
        Promise.resolve([{ _id: PATTY, name: 'Angus 100 g', unit: 'un', averageCost: 2.5 }]),
    }),
  });
  ingredientCountMock.mockResolvedValue(1);
});

describe('getModifiersForStore', () => {
  it('lists one entry per PDV code with its price range, groups and recipe state', async () => {
    aggregateMock.mockResolvedValue([
      {
        _id: '806',
        names: ['Blend Angus (100g)'],
        groups: ['Adicionais'],
        prices: [6, 7],
        products: ['a', 'b', 'c'],
      },
      { _id: '575', names: ['Ao Ponto'], groups: ['Ponto da Carne'], prices: [0], products: ['a'] },
      { _id: '192', names: ['Molho da Casa'], groups: ['Molho'], prices: [0], products: ['a'] },
    ]);
    loadSharedMock.mockResolvedValue(
      new Map([
        ['806', [{ rawIngredientId: PATTY, quantity: 1 }]],
        ['575', []], // saved empty: consumes nothing
      ]),
    );
    const { getModifiersForStore } = await import('@/app/lib/services/modifiers');

    const items = await getModifiersForStore(STORE_ID);

    const byCode = Object.fromEntries(items.map((item) => [item.codPdv, item]));
    expect(byCode['806']).toMatchObject({
      priceMin: 6,
      priceMax: 7,
      productsCount: 3,
      configured: true,
      cost: 2.5,
    });
    expect(byCode['806']?.recipe[0]).toMatchObject({ name: 'Angus 100 g', quantity: 1 });
    expect(byCode['575']).toMatchObject({ configured: true, recipe: [] });
    expect(byCode['192']).toMatchObject({ configured: false, recipe: [] });
    expect(loadSharedMock.mock.calls[0]?.[1]).toBe('modifier');
  });

  it('pages the list in memory', async () => {
    aggregateMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        _id: String(i),
        names: [`C${String(i).padStart(2, '0')}`],
        groups: [],
        prices: [0],
        products: ['a'],
      })),
    );
    loadSharedMock.mockResolvedValue(new Map());
    const { getModifiersPageForStore } = await import('@/app/lib/services/modifiers');

    const page = await getModifiersPageForStore(STORE_ID, { page: 2, limit: 20 });

    expect(page).toMatchObject({ total: 25, page: 2, totalPages: 2 });
    expect(page.data).toHaveLength(5);
  });
});

describe('updateModifierRecipe', () => {
  it('saves under the code, and an empty recipe is allowed', async () => {
    const { updateModifierRecipe } = await import('@/app/lib/services/modifiers');

    await updateModifierRecipe({ storeId: STORE_ID, codPdv: '575', recipe: [] });

    expect(saveSharedMock).toHaveBeenCalledWith({
      storeId: STORE_ID,
      codPdv: '575',
      recipe: [],
      kind: 'modifier',
    });
    expect(ingredientCountMock).not.toHaveBeenCalled();
  });

  it('rejects an ingredient from another store or a repeated one', async () => {
    const { updateModifierRecipe } = await import('@/app/lib/services/modifiers');

    ingredientCountMock.mockResolvedValue(0);
    await expect(
      updateModifierRecipe({
        storeId: STORE_ID,
        codPdv: '806',
        recipe: [{ rawIngredientId: PATTY, quantity: 1 }],
      }),
    ).rejects.toThrow();
    await expect(
      updateModifierRecipe({
        storeId: STORE_ID,
        codPdv: '806',
        recipe: [
          { rawIngredientId: PATTY, quantity: 1 },
          { rawIngredientId: PATTY, quantity: 2 },
        ],
      }),
    ).rejects.toThrow();
    expect(saveSharedMock).not.toHaveBeenCalled();
  });
});
