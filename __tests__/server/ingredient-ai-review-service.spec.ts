/**
 * @jest-environment node
 */
export {};

// The AI review of the unreviewed ingredients, with the model replaced by a fake: what the service
// feeds it (only matching menu lines), what it writes back, and where it stops.
const updateOneMock = jest.fn();
const ingredientFindMock = jest.fn();
const productFindMock = jest.fn();
const recipeFindMock = jest.fn();

const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.sort = () => q;
  q.lean = () => Promise.resolve(rows);
  return q;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/lib/env', () => ({ env: { ANTHROPIC_API_KEY: 'test' } }));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock, updateOne: updateOneMock },
}));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: { find: productFindMock },
}));
jest.mock('@/app/models/product-recipes', () => ({
  __esModule: true,
  default: { find: recipeFindMock },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const proposal = (over: Record<string, unknown> = {}) => ({
  usedByRestaurant: true,
  kind: 'food',
  cleanName: 'Bacon',
  aliases: [],
  pack: null,
  mergeInto: null,
  confidence: 'high',
  note: 'ok',
  ...over,
});

function setup(drafts: unknown[]) {
  // 1st find: reviewed names, 2nd: drafts, 3rd: ingredients that are preparations.
  ingredientFindMock
    .mockReturnValueOnce(chain([{ name: 'Bacon' }]))
    .mockReturnValueOnce(chain(drafts))
    .mockReturnValueOnce(chain([]));
  productFindMock.mockReturnValue(
    chain([{ name: 'X-Bacon', recipe: [], modifiers: [{ name: 'Bacon', recipe: [] }] }]),
  );
  recipeFindMock.mockReturnValue(chain([]));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reviewDraftIngredients', () => {
  it('shows the model only the matching menu lines, writes the review and applies a confident call', async () => {
    setup([{ _id: 'a1', name: 'Bacon Fatiado 1kg', unit: 'un' }]);
    const call = jest
      .fn()
      .mockResolvedValue({ proposal: proposal(), inputTokens: 500, outputTokens: 100 });
    const { reviewDraftIngredients } = await import('@/app/lib/services/ingredient-ai-review');

    const summary = await reviewDraftIngredients({ storeId: STORE_ID, call });

    expect(call.mock.calls[0][0].menu.map((m: { label: string }) => m.label).sort()).toEqual([
      'Bacon',
      'X-Bacon',
    ]);
    expect(call.mock.calls[0][0].similar).toEqual(['Bacon']);
    expect(summary).toMatchObject({ analyzed: 1, inOperation: 1, outOfOperation: 0 });
    expect(updateOneMock).toHaveBeenCalledTimes(2);
    expect(updateOneMock.mock.calls[0][1].$set.aiReview).toMatchObject({ comparedWithMenu: true });
    // Only when nobody decided yet.
    expect(updateOneMock.mock.calls[1]).toEqual([
      { _id: 'a1', inOperation: { $exists: false } },
      { $set: { inOperation: true } },
    ]);
  });

  it('does not apply a low-confidence call and drops a merge target it never offered', async () => {
    setup([{ _id: 'a1', name: 'Mamão Formosa kg', unit: 'un' }]);
    const call = jest.fn().mockResolvedValue({
      proposal: proposal({ usedByRestaurant: false, confidence: 'low', mergeInto: 'Invented' }),
      inputTokens: 400,
      outputTokens: 80,
    });
    const { reviewDraftIngredients } = await import('@/app/lib/services/ingredient-ai-review');

    const summary = await reviewDraftIngredients({ storeId: STORE_ID, call });

    expect(call.mock.calls[0][0].menu).toEqual([]);
    expect(summary.outOfOperation).toBe(1);
    expect(updateOneMock).toHaveBeenCalledTimes(1);
    expect(updateOneMock.mock.calls[0][1].$set.aiReview.mergeInto).toBeUndefined();
  });

  it('skips an ingredient already in a recipe, counts a failure and stops at the budget', async () => {
    setup([
      { _id: 'in-recipe', name: 'Queijo Prato', unit: 'g' },
      { _id: 'b', name: 'Item B', unit: 'un' },
      { _id: 'c', name: 'Item C', unit: 'un' },
      { _id: 'd', name: 'Item D', unit: 'un' },
    ]);
    productFindMock.mockReturnValue(
      chain([{ name: 'X', recipe: [{ rawIngredientId: 'in-recipe' }], modifiers: [] }]),
    );
    const call = jest
      .fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValue({ proposal: proposal(), inputTokens: 5_000_000, outputTokens: 0 });
    const { reviewDraftIngredients } = await import('@/app/lib/services/ingredient-ai-review');

    const summary = await reviewDraftIngredients({ storeId: STORE_ID, call, maxUsd: 0.1 });

    expect(summary).toMatchObject({ skippedInRecipe: 1, failed: 1, analyzed: 1 });
    expect(summary.stoppedByBudget).toBe(true);
  });

  it('lets a useful cleaning item keep following its kind', async () => {
    setup([{ _id: 'a1', name: 'Agua Sanitaria Zupp 1l', unit: 'un' }]);
    const call = jest.fn().mockResolvedValue({
      proposal: proposal({ kind: 'cleaning' }),
      inputTokens: 100,
      outputTokens: 50,
    });
    const { reviewDraftIngredients } = await import('@/app/lib/services/ingredient-ai-review');

    await reviewDraftIngredients({ storeId: STORE_ID, call });

    expect(updateOneMock).toHaveBeenCalledTimes(1);
  });
});
