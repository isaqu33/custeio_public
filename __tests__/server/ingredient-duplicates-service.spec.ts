/**
 * @jest-environment node
 */
export {};

// Duplicate suggestions: what is asked of the AI, what is stored, and what the list drops.
const ingredientFindMock = jest.fn();
const suggestionFindMock = jest.fn();
const suggestionDeleteManyMock = jest.fn();
const suggestionCreateMock = jest.fn();

const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.sort = () => q;
  q.lean = () => Promise.resolve(rows);
  return q;
};

const mergeMock = jest.fn();
jest.mock('@/app/lib/services/ingredient-merge', () => ({
  ...jest.requireActual('@/app/lib/services/ingredient-merge'),
  mergeRawIngredients: mergeMock,
}));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/lib/env', () => ({ env: { ANTHROPIC_API_KEY: 'test' } }));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock },
}));
jest.mock('@/app/models/ingredient-merge-suggestions', () => ({
  __esModule: true,
  default: {
    find: suggestionFindMock,
    deleteMany: suggestionDeleteManyMock,
    create: suggestionCreateMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ID = (n: number) => `665f735a90788d97f5a7632${n}`;
const row = (n: number, name: string, unit = 'g', extra = {}) => ({
  _id: ID(n),
  name,
  unit,
  currentStock: 1000,
  averageCost: 0.02,
  kind: 'food',
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('findDuplicateSuggestions', () => {
  it('asks per word-cluster, stores a ready group, remembers nothing dismissed twice', async () => {
    ingredientFindMock.mockReturnValue(
      chain([
        row(1, 'Bacon Fatiado Sadia'),
        row(2, 'Bacon Perdigao'),
        row(3, 'Mamao Formosa', 'g', { inOperation: false }),
      ]),
    );
    suggestionFindMock.mockReturnValue(chain([]));
    const call = jest.fn().mockResolvedValue({
      proposals: [
        {
          keep: 'Bacon Fatiado Sadia',
          merge: ['Bacon Perdigao'],
          confidence: 'high',
          reason: 'mesmo bacon',
          shouldMerge: true,
        },
      ],
      inputTokens: 100,
      outputTokens: 50,
    });
    const { findDuplicateSuggestions } = await import('@/app/lib/services/ingredient-duplicates');

    const summary = await findDuplicateSuggestions({ storeId: STORE_ID, call });

    // Out-of-operation items are never offered to the AI.
    expect(call.mock.calls[0][0].map((r: { name: string }) => r.name).sort()).toEqual([
      'Bacon Fatiado Sadia',
      'Bacon Perdigao',
    ]);
    expect(summary.suggestions).toBe(1);
    expect(suggestionDeleteManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(suggestionCreateMock.mock.calls[0][0]).toMatchObject({
      signature: [ID(1), ID(2)].sort().join(','),
      confidence: 'high',
    });
  });

  it('does not store a group the owner already dismissed', async () => {
    ingredientFindMock.mockReturnValue(chain([row(1, 'Bacon Sadia'), row(2, 'Bacon Perdigao')]));
    suggestionFindMock.mockReturnValue(chain([{ signature: [ID(1), ID(2)].sort().join(',') }]));
    const call = jest.fn().mockResolvedValue({
      proposals: [
        {
          keep: 'Bacon Sadia',
          merge: ['Bacon Perdigao'],
          confidence: 'high',
          reason: '',
          shouldMerge: true,
        },
      ],
      inputTokens: 1,
      outputTokens: 1,
    });
    const { findDuplicateSuggestions } = await import('@/app/lib/services/ingredient-duplicates');

    const summary = await findDuplicateSuggestions({ storeId: STORE_ID, call });

    expect(summary.suggestions).toBe(0);
    expect(suggestionCreateMock).not.toHaveBeenCalled();
  });
});

describe('automatic merge', () => {
  const group = (extra = {}) => ({
    keep: 'Bacon',
    merge: ['Bacon Sadia'],
    confidence: 'high' as const,
    reason: 'mesmo bacon',
    ...extra,
  });
  const rows = (draft: boolean, unit = 'g') =>
    new Map([
      ['Bacon', row(1, 'Bacon')],
      ['Bacon Sadia', row(2, 'Bacon Sadia', unit, { isDraft: draft })],
    ]);

  it('qualifies only a settled ingredient absorbing drafts, sure and in the same unit', async () => {
    const { isSafeAutoMerge } = await import('@/app/lib/services/ingredient-duplicates');

    expect(isSafeAutoMerge(group(), rows(true))).toBe(true);
    expect(isSafeAutoMerge(group(), rows(false))).toBe(false);
    expect(isSafeAutoMerge(group({ confidence: 'medium' }), rows(true))).toBe(false);
    expect(isSafeAutoMerge(group({ convertFirst: 'x' }), rows(true))).toBe(false);
    expect(isSafeAutoMerge(group(), rows(true, 'un'))).toBe(false);
    const draftKeep = rows(true);
    draftKeep.set('Bacon', row(1, 'Bacon', 'g', { isDraft: true }));
    expect(isSafeAutoMerge(group(), draftKeep)).toBe(false);
  });

  it('merges the safe group and stores nothing for it', async () => {
    ingredientFindMock.mockReturnValue(
      chain([row(1, 'Bacon'), row(2, 'Bacon Sadia', 'g', { isDraft: true })]),
    );
    suggestionFindMock.mockReturnValue(chain([]));
    mergeMock.mockResolvedValue({ merged: 1 });
    const call = jest.fn().mockResolvedValue({
      proposals: [
        {
          keep: 'Bacon',
          merge: ['Bacon Sadia'],
          confidence: 'high',
          reason: 'x',
          shouldMerge: true,
        },
      ],
      inputTokens: 1,
      outputTokens: 1,
    });
    const { findDuplicateSuggestions } = await import('@/app/lib/services/ingredient-duplicates');

    const summary = await findDuplicateSuggestions({ storeId: STORE_ID, call, autoMerge: true });

    expect(mergeMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: ID(1), sourceIds: [ID(2)] }),
    );
    expect(summary.autoMerged).toEqual([{ kept: 'Bacon', merged: ['Bacon Sadia'] }]);
    expect(summary.suggestions).toBe(0);
    expect(suggestionCreateMock).not.toHaveBeenCalled();
  });

  it('keeps it as a suggestion when the merge fails', async () => {
    ingredientFindMock.mockReturnValue(
      chain([row(1, 'Bacon'), row(2, 'Bacon Sadia', 'g', { isDraft: true })]),
    );
    suggestionFindMock.mockReturnValue(chain([]));
    mergeMock.mockRejectedValue(new Error('clash'));
    const call = jest.fn().mockResolvedValue({
      proposals: [
        {
          keep: 'Bacon',
          merge: ['Bacon Sadia'],
          confidence: 'high',
          reason: 'x',
          shouldMerge: true,
        },
      ],
      inputTokens: 1,
      outputTokens: 1,
    });
    const { findDuplicateSuggestions } = await import('@/app/lib/services/ingredient-duplicates');

    const summary = await findDuplicateSuggestions({ storeId: STORE_ID, call, autoMerge: true });

    expect(summary.autoMerged).toEqual([]);
    expect(summary.suggestions).toBe(1);
  });
});

describe('listDuplicateSuggestions', () => {
  it('shows what the merge would leave, and drops a suggestion whose ingredient is gone', async () => {
    suggestionFindMock.mockReturnValue(
      chain([
        { _id: 's1', keepId: ID(1), mergeIds: [ID(2)], confidence: 'high', reason: 'ok' },
        { _id: 's2', keepId: ID(1), mergeIds: [ID(9)], confidence: 'high', reason: 'gone' },
      ]),
    );
    ingredientFindMock.mockReturnValue(
      chain([
        row(1, 'Bacon', 'g', { currentStock: 1000, averageCost: 0.04 }),
        row(2, 'Bacon Perdigao', 'g', { currentStock: 3000, averageCost: 0.02 }),
      ]),
    );
    const { listDuplicateSuggestions } = await import('@/app/lib/services/ingredient-duplicates');

    const items = await listDuplicateSuggestions(STORE_ID);

    expect(items).toHaveLength(1);
    expect(items[0]?.after).toEqual({ currentStock: 4000, averageCost: 0.025 });
    expect(suggestionDeleteManyMock).toHaveBeenCalledWith({ _id: { $in: ['s2'] } });
  });
});
