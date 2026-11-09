/**
 * @jest-environment node
 */
export {};

// The Produtos page's data layer: the Alloy menu mirrored per store, with cost
// and margin derived from the recipe (ficha técnica) a person fills in.
const connectDBMock = jest.fn();
const productFindMock = jest.fn();
const productCountMock = jest.fn();
const productFindByIdMock = jest.fn();
const productUpdateMock = jest.fn();
const ingredientFindMock = jest.fn();
const ingredientCountMock = jest.fn();
const sharedFindMock = jest.fn();
const sharedUpdateOneMock = jest.fn();

// Every query builder step returns the same chain; `lean()` resolves the value.
function chain(result: unknown) {
  const link: Record<string, unknown> = {};
  for (const step of ['select', 'sort', 'skip', 'limit']) link[step] = () => link;
  link.lean = () => Promise.resolve(result);
  return link;
}

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
  class UnprocessableEntityError extends HttpError {
    constructor(message = 'Unprocessable.') {
      super(422, message);
      this.name = 'UnprocessableEntityError';
    }
  }
  return { HttpError, NotFoundError, UnprocessableEntityError };
});
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: {
    find: productFindMock,
    countDocuments: productCountMock,
    findById: productFindByIdMock,
    findByIdAndUpdate: productUpdateMock,
  },
}));
jest.mock('@/app/models/product-recipes', () => ({
  __esModule: true,
  default: { find: sharedFindMock, updateOne: sharedUpdateOneMock },
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock, countDocuments: ingredientCountMock },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const PRODUCT_ID = '665f735a90788d97f5a76400';
const ING_CHEESE = '665f735a90788d97f5a76a01';
const ING_BEEF = '665f735a90788d97f5a76a02';

function productDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: PRODUCT_ID,
    storeId: STORE_ID,
    externalId: '1208901',
    name: 'X-Bacon',
    categoryName: 'Hambúrguer',
    sellingPrice: 30,
    isActive: true,
    recipe: [],
    modifiers: [{ externalId: 'm1' }, { externalId: 'm2' }],
    ...overrides,
  };
}

const ingredients = [
  { _id: ING_CHEESE, name: 'Queijo', unit: 'g', averageCost: 0.04 },
  { _id: ING_BEEF, name: 'Carne', unit: 'g', averageCost: 0.05 },
];

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  productFindMock.mockReturnValue(chain([productDoc()]));
  productCountMock.mockResolvedValue(1);
  ingredientFindMock.mockReturnValue(chain(ingredients));
  ingredientCountMock.mockResolvedValue(2);
  sharedFindMock.mockReturnValue(chain([]));
  sharedUpdateOneMock.mockResolvedValue({});
});

describe('computeProductEconomics', () => {
  it('has no cost or margin without a recipe (never a misleading zero)', async () => {
    const { computeProductEconomics } = await import('@/app/lib/services/products');

    expect(computeProductEconomics(30, [])).toEqual({ costIncomplete: false });
  });

  it('sums quantity × average cost and derives the margin', async () => {
    const { computeProductEconomics } = await import('@/app/lib/services/products');

    const result = computeProductEconomics(30, [
      { quantity: 150, averageCost: 0.05 }, // 7.50
      { quantity: 50, averageCost: 0.04 }, // 2.00
    ]);

    expect(result.cost).toBeCloseTo(9.5);
    expect(result.margin).toBeCloseTo(20.5);
    expect(result.marginPercent).toBeCloseTo(68.33, 1);
    expect(result.costIncomplete).toBe(false);
  });

  it.each([
    ['an ingredient with no cost yet', [{ quantity: 10, averageCost: 0 }]],
    ['an ingredient that no longer exists', [{ quantity: 10, averageCost: undefined }]],
  ])('flags the cost as incomplete for %s', async (_label, lines) => {
    const { computeProductEconomics } = await import('@/app/lib/services/products');

    expect(computeProductEconomics(30, lines).costIncomplete).toBe(true);
  });

  it('has no margin percent when the price is 0', async () => {
    const { computeProductEconomics } = await import('@/app/lib/services/products');

    expect(
      computeProductEconomics(0, [{ quantity: 1, averageCost: 2 }]).marginPercent,
    ).toBeUndefined();
  });
});

describe('getProductsPageForStore', () => {
  it('lists a page with the recipe resolved to ingredient names and the economics filled in', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({
          recipe: [
            { rawIngredientId: ING_BEEF, quantity: 150 },
            { rawIngredientId: ING_CHEESE, quantity: 50 },
          ],
        }),
      ]),
    );
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    const page = await getProductsPageForStore(STORE_ID, { status: 'all' });

    expect(page.data[0]).toMatchObject({
      name: 'X-Bacon',
      price: 30,
      modifiersCount: 2,
      recipe: [
        { name: 'Carne', unit: 'g', quantity: 150 },
        { name: 'Queijo', unit: 'g', quantity: 50 },
      ],
      costIncomplete: false,
    });
    expect(page.data[0]?.cost).toBeCloseTo(9.5);
    expect(page).toMatchObject({ total: 1, page: 1, totalPages: 1 });
  });

  it('uses the promotional price for the margin while a promotion is on', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({
          promotionalPrice: 20,
          recipe: [{ rawIngredientId: ING_BEEF, quantity: 100 }],
        }),
      ]),
    );
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    const [item] = (await getProductsPageForStore(STORE_ID)).data;

    expect(item).toMatchObject({ sellingPrice: 30, promotionalPrice: 20, price: 20 });
    expect(item?.margin).toBeCloseTo(15);
  });

  it('keeps a recipe line whose ingredient was deleted, visible and costless', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({ recipe: [{ rawIngredientId: '665f735a90788d97f5a76aff', quantity: 5 }] }),
      ]),
    );
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    const [item] = (await getProductsPageForStore(STORE_ID)).data;

    expect(item?.recipe).toEqual([
      { rawIngredientId: '665f735a90788d97f5a76aff', name: '', unit: 'un', quantity: 5 },
    ]);
    expect(item?.costIncomplete).toBe(true);
  });

  it('filters by status and searches the name with the term escaped', async () => {
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    await getProductsPageForStore(STORE_ID, { status: 'active', q: ' (bacon ' });

    const query = productFindMock.mock.calls[0][0];
    expect(query.isActive).toBe(true);
    expect(query.name).toEqual({ $regex: '\\(bacon', $options: 'i' });
    expect(productCountMock).toHaveBeenCalledWith(query);
  });

  it.each([
    ['inactive', { isActive: false }],
    ['all', {}],
  ] as const)('status "%s"', async (status, expected) => {
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    await getProductsPageForStore(STORE_ID, { status });

    const query = productFindMock.mock.calls[0][0];
    expect(query.isActive).toEqual((expected as { isActive?: boolean }).isActive);
  });

  it('does not query ingredients when no recipe references any', async () => {
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    await getProductsPageForStore(STORE_ID);

    expect(ingredientFindMock).not.toHaveBeenCalled();
  });
});

describe('getRecipeCopySourcesForStore', () => {
  it('lists only the active products that already have a recipe, with lines the editor can copy', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({ name: 'Adão', recipe: [{ rawIngredientId: ING_BEEF, quantity: 150 }] }),
        productDoc({ _id: '665f735a90788d97f5a76301', name: 'Sem ficha', recipe: [] }),
      ]),
    );
    const { getRecipeCopySourcesForStore } = await import('@/app/lib/services/products');

    const sources = await getRecipeCopySourcesForStore(STORE_ID);

    expect(productFindMock).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
    expect(sources).toEqual([
      {
        _id: expect.any(String),
        name: 'Adão',
        recipe: [{ rawIngredientId: ING_BEEF, quantity: 150 }],
      },
    ]);
  });
});

describe('getProductsSummaryForStore', () => {
  it('summarizes active products; margin averages only complete recipes', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({
          _id: 'a',
          sellingPrice: 30,
          recipe: [{ rawIngredientId: ING_BEEF, quantity: 100 }], // cost 5 -> 83.3%
          lastSeenAt: new Date('2026-09-26T10:00:00Z'),
        }),
        productDoc({ _id: 'b', sellingPrice: 20, recipe: [] }),
        productDoc({
          _id: 'c',
          sellingPrice: 10,
          recipe: [{ rawIngredientId: '665f735a90788d97f5a76aff', quantity: 1 }], // incomplete
          lastSeenAt: new Date('2026-09-25T10:00:00Z'),
        }),
      ]),
    );
    productCountMock.mockResolvedValue(43);
    const { getProductsSummaryForStore } = await import('@/app/lib/services/products');

    const summary = await getProductsSummaryForStore(STORE_ID);

    expect(summary).toMatchObject({
      activeProducts: 3,
      inactiveProducts: 43,
      withRecipe: 2,
      withoutRecipe: 1,
      lastSeenAt: '2026-09-26T10:00:00.000Z',
    });
    expect(summary.averagePrice).toBeCloseTo(20);
    expect(summary.averageMarginPercent).toBeCloseTo(83.33, 1);
  });

  it('is empty-safe', async () => {
    productFindMock.mockReturnValue(chain([]));
    productCountMock.mockResolvedValue(0);
    const { getProductsSummaryForStore } = await import('@/app/lib/services/products');

    expect(await getProductsSummaryForStore(STORE_ID)).toEqual({
      activeProducts: 0,
      inactiveProducts: 0,
      withRecipe: 0,
      withoutRecipe: 0,
      averagePrice: 0,
      averageMarginPercent: undefined,
      lastSeenAt: undefined,
    });
  });
});

describe('shared recipes by PDV code', () => {
  it('lists every copy of a product with the recipe saved under its code', async () => {
    productFindMock.mockReturnValue(
      chain([
        productDoc({ codPdv: '266', recipe: [] }),
        productDoc({ _id: 'copy', codPdv: '266', recipe: [] }),
      ]),
    );
    sharedFindMock.mockReturnValue(
      chain([{ codPdv: '266', recipe: [{ rawIngredientId: ING_BEEF, quantity: 100 }] }]),
    );
    const { getProductsPageForStore } = await import('@/app/lib/services/products');

    const page = await getProductsPageForStore(STORE_ID);

    expect(page.data.map((item) => item.recipe.length)).toEqual([1, 1]);
    expect(page.data[0]?.cost).toBeCloseTo(5);
  });
});

describe('updateProductRecipe', () => {
  const recipe = [
    { rawIngredientId: ING_BEEF, quantity: 150 },
    { rawIngredientId: ING_CHEESE, quantity: 50 },
  ];

  beforeEach(() => {
    productFindByIdMock.mockReturnValue(chain({ storeId: STORE_ID }));
    productUpdateMock.mockReturnValue(
      chain(productDoc({ recipe: recipe.map((line) => ({ ...line })) })),
    );
  });

  it('replaces the recipe and returns the product with its economics', async () => {
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    const item = await updateProductRecipe({ id: PRODUCT_ID, recipe });

    const [, update] = productUpdateMock.mock.calls[0];
    expect(update.$set.recipe).toHaveLength(2);
    expect(update.$set.recipe[0].quantity).toBe(150);
    expect(item.cost).toBeCloseTo(9.5);
  });

  it('saves a product with a PDV code under that code, shared by its copies, not on the row', async () => {
    productFindByIdMock.mockReturnValue(chain({ storeId: STORE_ID, codPdv: '218' }));
    productUpdateMock.mockReturnValue(chain(productDoc({ codPdv: '218', recipe: [] })));
    sharedFindMock.mockReturnValue(
      chain([{ codPdv: '218', recipe: recipe.map((line) => ({ ...line })) }]),
    );
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    const item = await updateProductRecipe({ id: PRODUCT_ID, recipe });

    const [filter, update, options] = sharedUpdateOneMock.mock.calls[0];
    expect(filter).toMatchObject({ kind: 'product', codPdv: '218' });
    expect(update.$set.recipe).toHaveLength(2);
    expect(options).toEqual({ upsert: true });
    expect(productUpdateMock.mock.calls[0][1]).toEqual({}); // the row's own recipe is untouched
    expect(item.cost).toBeCloseTo(9.5); // read back through the shared recipe
  });

  it('can clear the recipe', async () => {
    productUpdateMock.mockReturnValue(chain(productDoc({ recipe: [] })));
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    const item = await updateProductRecipe({ id: PRODUCT_ID, recipe: [] });

    expect(productUpdateMock.mock.calls[0][1].$set.recipe).toEqual([]);
    expect(item.recipe).toEqual([]);
    expect(ingredientCountMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown product', async () => {
    productFindByIdMock.mockReturnValue(chain(null));
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    await expect(updateProductRecipe({ id: PRODUCT_ID, recipe })).rejects.toMatchObject({
      status: 404,
    });
    expect(productUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects the same ingredient twice', async () => {
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    await expect(
      updateProductRecipe({
        id: PRODUCT_ID,
        recipe: [recipe[0]!, { rawIngredientId: ING_BEEF, quantity: 10 }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(productUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects an ingredient that belongs to another store', async () => {
    ingredientCountMock.mockResolvedValue(1); // only one of the two is in this store
    const { updateProductRecipe } = await import('@/app/lib/services/products');

    await expect(updateProductRecipe({ id: PRODUCT_ID, recipe })).rejects.toMatchObject({
      status: 422,
    });
    expect(productUpdateMock).not.toHaveBeenCalled();
    const filter = ingredientCountMock.mock.calls[0][0];
    expect(String(filter.storeId)).toBe(STORE_ID);
  });
});

describe('getProductStoreId', () => {
  it('resolves the owning store, or null', async () => {
    productFindByIdMock.mockReturnValue(chain({ storeId: STORE_ID }));
    const { getProductStoreId } = await import('@/app/lib/services/products');
    expect(await getProductStoreId(PRODUCT_ID)).toBe(STORE_ID);

    productFindByIdMock.mockReturnValue(chain(null));
    expect(await getProductStoreId(PRODUCT_ID)).toBeNull();
  });
});
