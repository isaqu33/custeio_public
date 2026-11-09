/**
 * @jest-environment node
 */
export {};

// The Pedidos screen's data: the list and its filters, the incomplete-order summary and the
// "what to register first" ranking, all scoped to one store.
const connectDBMock = jest.fn();
const findMock = jest.fn();
const countMock = jest.fn();
const aggregateMock = jest.fn();

const chain = (result: unknown) => {
  const link: Record<string, unknown> = {};
  for (const step of ['select', 'sort', 'skip', 'limit']) link[step] = () => link;
  link.lean = () => Promise.resolve(result);
  return link;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/orders', () => ({
  __esModule: true,
  default: { find: findMock, countDocuments: countMock, aggregate: aggregateMock },
}));

const STORE = '665f735a90788d97f5a76322';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  findMock.mockReturnValue(chain([]));
  countMock.mockResolvedValue(0);
  aggregateMock.mockResolvedValue([]);
});

describe('getOrdersPageForStore', () => {
  it('maps an order with its items, complements, cost and what is missing', async () => {
    findMock.mockReturnValue(
      chain([
        {
          _id: 'o1',
          externalOrderId: '1527',
          placedAt: new Date('2026-10-02T23:25:40Z'),
          channel: 'didifood',
          totalValue: 75.8,
          calculatedCost: 7.5,
          profitMargin: 0.9,
          stockStatus: 'debited',
          incompleteLines: [{ kind: 'modifier', codPdv: '802', name: 'Fritas Combo' }],
          items: [
            {
              quantity: 2,
              name: 'Casa Burguer + Fritas',
              modifiers: [
                { name: 'Fritas Combo', quantity: 3 },
                { name: 'Ao Ponto', quantity: 1 },
              ],
            },
          ],
        },
      ]),
    );
    countMock.mockResolvedValue(1);
    const { getOrdersPageForStore } = await import('@/app/lib/services/orders');

    const page = await getOrdersPageForStore(STORE);

    expect(page.data[0]).toMatchObject({
      externalOrderId: '1527',
      channel: 'didifood',
      stockStatus: 'debited',
      totalValue: 75.8,
      calculatedCost: 7.5,
      items: [
        {
          quantity: 2,
          name: 'Casa Burguer + Fritas',
          modifiers: ['3x Fritas Combo', 'Ao Ponto'],
        },
      ],
      incompleteLines: [{ kind: 'modifier', codPdv: '802', name: 'Fritas Combo' }],
    });
    expect(page).toMatchObject({ total: 1, page: 1, totalPages: 1 });
  });

  it('filters incomplete orders as debited ones that still have a line without a recipe', async () => {
    const { getOrdersPageForStore } = await import('@/app/lib/services/orders');

    await getOrdersPageForStore(STORE, { filter: 'incomplete' });

    expect(findMock.mock.calls[0]?.[0]).toMatchObject({
      stockStatus: 'debited',
      'incompleteLines.0': { $exists: true },
    });
  });

  it('searches by order reference (with or without #) or by product / complement name', async () => {
    const { getOrdersPageForStore } = await import('@/app/lib/services/orders');

    await getOrdersPageForStore(STORE, { q: '#1527' });

    const query = findMock.mock.calls[0]?.[0] as { $or: Array<Record<string, unknown>> };
    expect(query.$or[0]).toEqual({ externalOrderId: '1527' });
    expect(Object.keys(query.$or[1] ?? {})).toEqual(['items.name']);
    expect(Object.keys(query.$or[2] ?? {})).toEqual(['items.modifiers.name']);
  });
});

describe('getOrdersSummaryForStore', () => {
  it('reports how many debited orders were incomplete, their revenue and the coverage', async () => {
    countMock.mockResolvedValueOnce(12).mockResolvedValueOnce(10);
    aggregateMock.mockResolvedValue([{ count: 4, revenue: 310.4 }]);
    const { getOrdersSummaryForStore } = await import('@/app/lib/services/orders');

    const summary = await getOrdersSummaryForStore(STORE);

    expect(summary).toEqual({
      orders: 12,
      debited: 10,
      incomplete: 4,
      incompleteRevenue: 310.4,
      coverage: 0.6,
    });
  });

  it('has no coverage while nothing was debited', async () => {
    const { getOrdersSummaryForStore } = await import('@/app/lib/services/orders');

    const summary = await getOrdersSummaryForStore(STORE);

    expect(summary).toMatchObject({ incomplete: 0, incompleteRevenue: 0, coverage: undefined });
  });
});

describe('getMissingRecipesForStore', () => {
  it('ranks what is missing by the money of the orders it appears on', async () => {
    aggregateMock.mockResolvedValue([
      {
        _id: { kind: 'modifier', codPdv: '147', name: 'Molho Barbecue Extra' },
        orders: 5,
        revenue: 410.5,
      },
      { _id: { kind: 'product', name: 'Adão Burguer + Fritas' }, orders: 2, revenue: 57.8 },
    ]);
    const { getMissingRecipesForStore } = await import('@/app/lib/services/orders');

    const rows = await getMissingRecipesForStore(STORE);

    expect(rows).toEqual([
      { kind: 'modifier', codPdv: '147', name: 'Molho Barbecue Extra', orders: 5, revenue: 410.5 },
      { kind: 'product', codPdv: '', name: 'Adão Burguer + Fritas', orders: 2, revenue: 57.8 },
    ]);
    const pipeline = aggregateMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(pipeline[0]).toMatchObject({ $match: { stockStatus: 'debited' } });
    expect(pipeline.some((stage) => '$unwind' in stage)).toBe(true);
  });
});
