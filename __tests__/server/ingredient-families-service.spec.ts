/**
 * @jest-environment node
 */
export {};

// Family grouping: what is asked of the AI, what the code accepts, and what is written.
const findMock = jest.fn();
const distinctMock = jest.fn();
const updateOneMock = jest.fn();
const updateManyMock = jest.fn();

const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.lean = () => Promise.resolve(rows);
  return q;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/lib/env', () => ({ env: { ANTHROPIC_API_KEY: 'test' } }));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: {
    find: findMock,
    distinct: distinctMock,
    updateOne: updateOneMock,
    updateMany: updateManyMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ID = (n: number) => `665f735a90788d97f5a7632${n}`;
const row = (n: number, name: string, extra = {}) => ({
  _id: ID(n),
  name,
  unit: 'g',
  kind: 'food',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  distinctMock.mockResolvedValue([]);
  updateOneMock.mockResolvedValue({ modifiedCount: 1 });
  updateManyMock.mockResolvedValue({});
});

describe('familyClusters', () => {
  it('groups by the first significant word and skips lone or fully-checked groups', async () => {
    const { familyClusters } = await import('@/app/lib/services/ingredient-families');
    const checked = { familyAiCheckedAt: new Date() };
    const clusters = familyClusters([
      row(1, 'Bacon'),
      row(2, 'Bacon Meia Manta Pd'),
      row(3, 'Cebola Roxa Uniao Kg'),
      row(4, 'Tomate Italiano', checked),
      row(5, 'Tomate Kg', checked),
    ]);

    expect(clusters.map((c) => c.map((r) => r.name))).toEqual([['Bacon', 'Bacon Meia Manta Pd']]);
  });
});

describe('acceptFamilyProposals', () => {
  it('accepts only offered names, confident groups, and one level of family', async () => {
    const { acceptFamilyProposals } = await import('@/app/lib/services/ingredient-families');
    const cluster = [
      row(1, 'Bacon'),
      row(2, 'Bacon Sadia'),
      row(3, 'Bacon Fatiado', { hasVariants: true }),
      row(4, 'Bacon Antigo', { familyAiCheckedAt: new Date() }),
    ];

    const accepted = acceptFamilyProposals(cluster, [
      {
        main: 'Bacon',
        variants: ['Bacon Sadia', 'Bacon Fatiado', 'Bacon Antigo', 'Inventado', 'Bacon'],
        confidence: 'high',
      },
      { main: 'Bacon Sadia', variants: ['Bacon Fatiado'], confidence: 'low' },
    ]);

    expect(accepted).toEqual([{ variantId: ID(2), mainId: ID(1) }]);
  });

  it('refuses a main whose name carries a size', async () => {
    const { acceptFamilyProposals } = await import('@/app/lib/services/ingredient-families');
    const cluster = [row(1, 'Refri Guarana 200ml'), row(2, 'Refri Guarana 2l')];

    expect(
      acceptFamilyProposals(cluster, [
        { main: 'Refri Guarana 200ml', variants: ['Refri Guarana 2l'], confidence: 'high' },
      ]),
    ).toEqual([]);
  });

  it('never makes a variation the main of another group', async () => {
    const { acceptFamilyProposals } = await import('@/app/lib/services/ingredient-families');
    const cluster = [row(1, 'Bacon'), row(2, 'Bacon Sadia'), row(3, 'Bacon Fatiado')];

    const accepted = acceptFamilyProposals(cluster, [
      { main: 'Bacon', variants: ['Bacon Sadia'], confidence: 'high' },
      { main: 'Bacon Sadia', variants: ['Bacon Fatiado'], confidence: 'medium' },
    ]);

    expect(accepted).toEqual([{ variantId: ID(2), mainId: ID(1) }]);
  });
});

describe('groupIngredientFamilies', () => {
  it('writes the family and marks the cluster as looked at; out-of-operation items are not offered', async () => {
    findMock.mockReturnValue(
      chain([
        row(1, 'Bacon'),
        row(2, 'Bacon Meia Manta Pd'),
        row(3, 'Bacon Podre', { inOperation: false }),
        row(4, 'Cebola Caramelizada', { isPreparation: true }),
        row(5, 'Cebola Roxa'),
      ]),
    );
    const call = jest.fn().mockResolvedValue({
      proposals: [{ main: 'Bacon', variants: ['Bacon Meia Manta Pd'], confidence: 'high' }],
      inputTokens: 100,
      outputTokens: 50,
    });
    const { groupIngredientFamilies } = await import('@/app/lib/services/ingredient-families');

    const summary = await groupIngredientFamilies({ storeId: STORE_ID, call });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].map((r: { name: string }) => r.name)).toEqual([
      'Bacon',
      'Bacon Meia Manta Pd',
    ]);
    expect(updateOneMock).toHaveBeenCalledTimes(1);
    expect(String(updateOneMock.mock.calls[0][1].$set.familyOf)).toBe(ID(1));
    expect(updateManyMock.mock.calls[0][1].$set.familyAiCheckedAt).toBeInstanceOf(Date);
    expect(summary).toMatchObject({ clusters: 1, grouped: 1, stoppedByBudget: false });
  });

  it('stops past the budget', async () => {
    findMock.mockReturnValue(
      chain([row(1, 'Bacon'), row(2, 'Bacon Sadia'), row(3, 'Tomate'), row(4, 'Tomate Kg')]),
    );
    const call = jest
      .fn()
      .mockResolvedValue({ proposals: [], inputTokens: 10_000_000, outputTokens: 0 });
    const { groupIngredientFamilies } = await import('@/app/lib/services/ingredient-families');

    const summary = await groupIngredientFamilies({ storeId: STORE_ID, call, maxUsd: 0.5 });

    expect(call).toHaveBeenCalledTimes(1);
    expect(summary.stoppedByBudget).toBe(true);
  });
});
