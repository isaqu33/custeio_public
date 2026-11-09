import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import {
  buildSalesHistory,
  dateRange,
  type SaleOrder,
  type SalesHistory,
  startOfLocalDate,
} from '@/app/lib/sales-history';
import OrderDB from '@/app/models/orders';

// "Vendas": what the PDV sold by day, product and channel, from the orders Custeio holds. It needs
// no recipe, so it accumulates from the first order the webhook receives — the history any forecast
// will be built on.

const MAX_ORDERS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type OrderDoc = LeanDoc & {
  placedAt?: Date;
  channel?: string;
  totalValue?: number;
  calculatedCost?: number;
  incompleteLines?: unknown[];
  items?: Array<{ externalCode?: string; name?: string; quantity?: number }>;
};

/**
 * The last `days` days of sales of a store (the PDV's local days, ending today). Only accepted orders
 * count: a cancelled one is not a sale, one still pending has not been accepted, and the demo rows
 * made to show the Pedidos screen never came from a PDV.
 */
export async function getSalesHistoryForStore(
  storeId: string,
  params: { days?: number } = {},
): Promise<SalesHistory> {
  await connectDB();
  const days = Math.min(Math.max(params.days ?? 14, 1), 90);
  const dates = dateRange(days);
  const from = startOfLocalDate(dates[0] as string);
  const to = new Date(startOfLocalDate(dates[dates.length - 1] as string).getTime() + DAY_MS);

  const docs = await OrderDB.find({
    storeId: toObjectId(storeId),
    stockStatus: 'debited',
    demo: { $ne: true },
    placedAt: { $gte: from, $lt: to },
  })
    .select(
      'placedAt channel totalValue calculatedCost incompleteLines items.externalCode items.name items.quantity',
    )
    .limit(MAX_ORDERS)
    .lean<OrderDoc[]>();

  const orders = docs
    .filter((doc) => doc.placedAt)
    .map(
      (doc): SaleOrder => ({
        placedAt: doc.placedAt as Date,
        channel: doc.channel ?? 'own',
        totalValue: Number(doc.totalValue ?? 0),
        calculatedCost: Number(doc.calculatedCost ?? 0),
        incompleteLineCount: doc.incompleteLines?.length ?? 0,
        items: (doc.items ?? []).map((item) => ({
          code: String(item.externalCode ?? ''),
          name: String(item.name ?? ''),
          quantity: Number(item.quantity ?? 1),
        })),
      }),
    );
  return buildSalesHistory(orders, dates);
}
