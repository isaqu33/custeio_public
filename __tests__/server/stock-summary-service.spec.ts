/**
 * @jest-environment node
 */
export {};

// The Estoque header cards: store-wide totals, not the table's page.
const connectDBMock = jest.fn();
const ingredientAggregateMock = jest.fn();
const invoiceAggregateMock = jest.fn();
const mappingCountMock = jest.fn();
const invoiceDistinctMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
// No recipe uses anything in these tests.
jest.mock('@/app/lib/services/ingredient-usage', () => ({
  getIngredientIdsInRecipes: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { aggregate: ingredientAggregateMock },
}));
jest.mock('@/app/models/processed-invoices', () => ({
  __esModule: true,
  default: { aggregate: invoiceAggregateMock, distinct: invoiceDistinctMock },
}));
jest.mock('@/app/models/supplier-item-mappings', () => ({
  __esModule: true,
  default: { countDocuments: mappingCountMock },
}));

const STORE_ID = '665f735a90788d97f5a76322';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  ingredientAggregateMock.mockResolvedValue([]);
  invoiceAggregateMock.mockResolvedValue([]);
  mappingCountMock.mockResolvedValue(0);
  invoiceDistinctMock.mockResolvedValue([]);
});

describe('getStockSummaryForStore', () => {
  it('maps the aggregates to the summary', async () => {
    ingredientAggregateMock.mockResolvedValue([
      {
        _id: null,
        ingredients: 152,
        drafts: 150,
        nonOperational: 19,
        stockValue: 12490.05,
        lowStock: 3,
        outOfStock: 2,
      },
    ]);
    invoiceAggregateMock.mockResolvedValue([
      {
        _id: null,
        invoices: 24,
        totalValue: 12583.15,
        lastIssuedAt: new Date('2026-09-20T12:00:00Z'),
      },
    ]);
    mappingCountMock.mockResolvedValue(154);
    invoiceDistinctMock.mockResolvedValue(['111', '222', '333']);
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    expect(await getStockSummaryForStore(STORE_ID)).toEqual({
      ingredients: 152,
      drafts: 150,
      nonOperational: 19,
      stockValue: 12490.05,
      lowStock: 3,
      outOfStock: 2,
      suppliers: 3,
      invoices: 24,
      invoicesTotalValue: 12583.15,
      lastInvoiceAt: '2026-09-20T12:00:00.000Z',
      mappedItems: 154,
    });
  });

  it('returns zeros for a store with nothing yet', async () => {
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    expect(await getStockSummaryForStore(STORE_ID)).toEqual({
      ingredients: 0,
      drafts: 0,
      nonOperational: 0,
      stockValue: 0,
      lowStock: 0,
      outOfStock: 0,
      suppliers: 0,
      invoices: 0,
      invoicesTotalValue: 0,
      lastInvoiceAt: undefined,
      mappedItems: 0,
    });
  });

  it('scopes every query to the store, and counts only processed invoices', async () => {
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    await getStockSummaryForStore(STORE_ID);

    const ingredientMatch = ingredientAggregateMock.mock.calls[0][0][0].$match;
    const invoiceMatch = invoiceAggregateMock.mock.calls[0][0][0].$match;
    expect(String(ingredientMatch.storeId)).toBe(STORE_ID);
    expect(String(invoiceMatch.storeId)).toBe(STORE_ID);
    expect(invoiceMatch.status).toBe('processed');
    expect(String(mappingCountMock.mock.calls[0][0].storeId)).toBe(STORE_ID);
  });

  it('does not count a negative balance as stock value', async () => {
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    await getStockSummaryForStore(STORE_ID);

    const group = ingredientAggregateMock.mock.calls[0][0][1].$group;
    // Inside the "only what is part of the operation" condition.
    expect(JSON.stringify(group.stockValue)).toContain(
      '{"$multiply":[{"$max":[0,"$currentStock"]},"$averageCost"]}',
    );
  });

  it('leaves what is not part of the operation out of the value and the alerts', async () => {
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    await getStockSummaryForStore(STORE_ID);

    const group = ingredientAggregateMock.mock.calls[0][0][1].$group;
    // An explicit decision wins; else a food/packaging kind, and a draft only once a recipe uses it.
    const operational = JSON.stringify({
      $cond: [
        { $eq: [{ $type: '$inOperation' }, 'bool'] },
        '$inOperation',
        {
          $and: [
            { $in: [{ $ifNull: ['$kind', 'food'] }, ['food', 'packaging']] },
            { $or: [{ $ne: ['$isDraft', true] }, { $in: ['$_id', []] }] },
          ],
        },
      ],
    });
    expect(JSON.stringify(group.stockValue)).toContain(operational);
    expect(JSON.stringify(group.lowStock)).toContain(operational);
    expect(JSON.stringify(group.outOfStock)).toContain(operational);
    // ...and counts them, so the strip can say how many are outside the operation.
    expect(JSON.stringify(group.nonOperational)).toContain(operational);
  });

  it('counts the distinct suppliers of the processed invoices of the store only', async () => {
    const { getStockSummaryForStore } = await import('@/app/lib/services/stock-summary');

    await getStockSummaryForStore(STORE_ID);

    const [field, filter] = invoiceDistinctMock.mock.calls[0];
    expect(field).toBe('supplierCnpj');
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(filter.status).toBe('processed');
  });
});
