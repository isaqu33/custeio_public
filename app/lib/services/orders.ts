import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import { containsCondition } from '@/app/lib/search-regex';
import OrderDB from '@/app/models/orders';

// The Pedidos screen: the orders the PDV sent, what each took out of stock, and above all which
// ones were settled with a product or complement that had no recipe (so their cost is a floor).

export type OrderStockFilter = 'all' | 'incomplete' | 'debited' | 'pending' | 'reversed';

export type MissingLine = { kind: 'product' | 'modifier'; codPdv: string; name: string };

export type OrderListItem = {
  _id: string;
  externalOrderId: string;
  placedAt?: string;
  channel: string;
  items: Array<{ quantity: number; name: string; modifiers: string[] }>;
  /** What the PDV charged for the lines. */
  totalValue: number;
  /** Cost of the ingredients taken out of stock; a floor while `incompleteLines` is not empty. */
  calculatedCost: number;
  /** Fraction (0.42 = 42%). */
  profitMargin: number;
  stockStatus: 'pending' | 'debited' | 'reversed';
  incompleteLines: MissingLine[];
};

export type OrdersPage = {
  data: OrderListItem[];
  total: number;
  page: number;
  totalPages: number;
};

type OrderDoc = LeanDoc & {
  externalOrderId?: string;
  placedAt?: Date;
  channel?: string;
  totalValue?: number;
  calculatedCost?: number;
  profitMargin?: number;
  stockStatus?: OrderListItem['stockStatus'];
  incompleteLines?: MissingLine[];
  items?: Array<{
    quantity?: number;
    name?: string;
    modifiers?: Array<{ name?: string; quantity?: number }>;
  }>;
};

const LIST_FIELDS =
  'externalOrderId placedAt channel totalValue calculatedCost profitMargin stockStatus incompleteLines items';

function buildQuery(
  storeId: string,
  params: { q?: string; filter?: OrderStockFilter },
): Record<string, unknown> {
  const term = params.q?.trim();
  const filter = params.filter ?? 'all';
  return {
    storeId: toObjectId(storeId),
    ...(filter === 'incomplete' && {
      stockStatus: 'debited',
      'incompleteLines.0': { $exists: true },
    }),
    ...(filter === 'debited' && { stockStatus: 'debited' }),
    ...(filter === 'pending' && { stockStatus: 'pending' }),
    ...(filter === 'reversed' && { stockStatus: 'reversed' }),
    // An order reference ("1527") or part of a product / complement name.
    ...(term && {
      $or: [
        { externalOrderId: term.replace(/^#/, '') },
        { 'items.name': containsCondition(term) },
        { 'items.modifiers.name': containsCondition(term) },
      ],
    }),
  };
}

function toItem(doc: OrderDoc): OrderListItem {
  return {
    _id: String(doc._id),
    externalOrderId: String(doc.externalOrderId ?? ''),
    placedAt: doc.placedAt?.toISOString(),
    channel: String(doc.channel ?? 'own'),
    items: (doc.items ?? []).map((item) => ({
      quantity: Number(item.quantity ?? 1),
      name: String(item.name ?? ''),
      modifiers: (item.modifiers ?? []).map(
        (m) => `${Number(m.quantity ?? 1) > 1 ? `${m.quantity}x ` : ''}${m.name ?? ''}`,
      ),
    })),
    totalValue: Number(doc.totalValue ?? 0),
    calculatedCost: Number(doc.calculatedCost ?? 0),
    profitMargin: Number(doc.profitMargin ?? 0),
    stockStatus: doc.stockStatus ?? 'pending',
    incompleteLines: doc.incompleteLines ?? [],
  };
}

/** One page of a store's orders, newest first. */
export async function getOrdersPageForStore(
  storeId: string,
  params: { page?: number; limit?: number; q?: string; filter?: OrderStockFilter } = {},
): Promise<OrdersPage> {
  await connectDB();
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 20;
  const query = buildQuery(storeId, params);
  const [docs, total] = await Promise.all([
    OrderDB.find(query)
      .select(LIST_FIELDS)
      .sort({ placedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<OrderDoc[]>(),
    OrderDB.countDocuments(query),
  ]);
  return { data: docs.map(toItem), total, page, totalPages: totalPages(total, limit) };
}

export type OrdersSummary = {
  orders: number;
  debited: number;
  /** Debited orders with at least one line that had no recipe. */
  incomplete: number;
  /** What the PDV charged on those incomplete orders. */
  incompleteRevenue: number;
  /** Share of debited orders whose recipes were all known, 0–1; absent while nothing was debited. */
  coverage?: number;
};

export async function getOrdersSummaryForStore(storeId: string): Promise<OrdersSummary> {
  await connectDB();
  const store = toObjectId(storeId);
  const [orders, debited, [incomplete]] = await Promise.all([
    OrderDB.countDocuments({ storeId: store }),
    OrderDB.countDocuments({ storeId: store, stockStatus: 'debited' }),
    OrderDB.aggregate<{ count: number; revenue: number }>([
      {
        $match: { storeId: store, stockStatus: 'debited', 'incompleteLines.0': { $exists: true } },
      },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalValue' } } },
    ]),
  ]);
  const incompleteCount = incomplete?.count ?? 0;
  return {
    orders,
    debited,
    incomplete: incompleteCount,
    incompleteRevenue: Number((incomplete?.revenue ?? 0).toFixed(2)),
    coverage: debited > 0 ? (debited - incompleteCount) / debited : undefined,
  };
}

export type MissingRecipeRow = MissingLine & {
  /** How many debited orders carry it. */
  orders: number;
  /** What the PDV charged on those orders. */
  revenue: number;
};

/** What to register first: the products and complements missing a recipe, by money involved. */
export async function getMissingRecipesForStore(
  storeId: string,
  limit = 8,
): Promise<MissingRecipeRow[]> {
  await connectDB();
  const rows = await OrderDB.aggregate<{
    _id: MissingLine;
    orders: number;
    revenue: number;
  }>([
    {
      $match: {
        storeId: toObjectId(storeId),
        stockStatus: 'debited',
        'incompleteLines.0': { $exists: true },
      },
    },
    { $unwind: '$incompleteLines' },
    {
      $group: {
        _id: {
          kind: '$incompleteLines.kind',
          codPdv: '$incompleteLines.codPdv',
          name: '$incompleteLines.name',
        },
        orders: { $sum: 1 },
        revenue: { $sum: '$totalValue' },
      },
    },
    { $sort: { revenue: -1, orders: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({
    kind: row._id.kind,
    codPdv: row._id.codPdv ?? '',
    name: row._id.name,
    orders: row.orders,
    revenue: Number(row.revenue.toFixed(2)),
  }));
}

/** Resolves the owning store of an order — routes run the store → organization check before trusting it. */
export async function getOrderStoreId(id: string): Promise<string | null> {
  await connectDB();
  const doc = await OrderDB.findById(toObjectId(id)).select('storeId').lean<LeanDoc | null>();
  return doc ? String(doc.storeId) : null;
}
