// What the PDV sold, by day, by product and by channel, from the orders Custeio already holds.
// Pure and worker-safe. Counting sales per day is the first brick of any forecast: it does not need
// a recipe, so it can accumulate while the fichas are still being filled in.

export type SaleOrder = {
  placedAt: Date;
  channel: string;
  totalValue: number;
  calculatedCost: number;
  /** Lines of the order that could not be costed for lack of a recipe: its cost is only a floor. */
  incompleteLineCount: number;
  items: Array<{ code: string; name: string; quantity: number }>;
};

export type DaySales = {
  /** The PDV's local date, YYYY-MM-DD. */
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  orders: number;
  items: number;
  revenue: number;
  byChannel: Record<string, { orders: number; revenue: number }>;
};

export type ProductSales = { key: string; name: string; quantity: number; orders: number };

export type WeekdayAverage = {
  weekday: number;
  /** How many distinct dates of this weekday had sales: the sample behind the average. */
  dates: number;
  avgOrders: number;
  avgRevenue: number;
};

export type SalesHistory = {
  from: string;
  to: string;
  days: DaySales[];
  products: ProductSales[];
  weekdays: WeekdayAverage[];
  totals: {
    orders: number;
    items: number;
    revenue: number;
    avgTicket: number;
    /** Orders whose recipes were all found, and so whose cost is a real number. */
    completeOrders: number;
    /** (revenue − cost) / revenue over the complete orders only; null with none. */
    margin: number | null;
  };
};

// The PDV's local time (UTC-3, no daylight saving since 2019).
const LOCAL_OFFSET_MS = 3 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(at: Date): string {
  const local = new Date(at.getTime() - LOCAL_OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** The instant a local date starts (local midnight). */
export function startOfLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) + LOCAL_OFFSET_MS);
}

const round2 = (value: number) => Number(value.toFixed(2));

/** The last `days` local dates up to and including `to` (the PDV's today by default), oldest first. */
export function dateRange(days: number, to: Date = new Date()): string[] {
  const end = startOfLocalDate(localDate(to)).getTime();
  return Array.from({ length: days }, (_, i) =>
    localDate(new Date(end + (i - (days - 1)) * 24 * 60 * 60 * 1000 + LOCAL_OFFSET_MS)),
  );
}

function emptyDay(date: string): DaySales {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return {
    date,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    orders: 0,
    items: 0,
    revenue: 0,
    byChannel: {},
  };
}

function addOrderToDay(day: DaySales, order: SaleOrder) {
  day.orders += 1;
  day.revenue += order.totalValue;
  day.items += order.items.reduce((sum, item) => sum + item.quantity, 0);
  const channel = day.byChannel[order.channel] ?? { orders: 0, revenue: 0 };
  channel.orders += 1;
  channel.revenue += order.totalValue;
  day.byChannel[order.channel] = channel;
}

function weekdayAverages(days: DaySales[]): WeekdayAverage[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const sold = days.filter((day) => day.weekday === weekday && day.orders > 0);
    const count = sold.length;
    return {
      weekday,
      dates: count,
      avgOrders: count ? round2(sold.reduce((sum, d) => sum + d.orders, 0) / count) : 0,
      avgRevenue: count ? round2(sold.reduce((sum, d) => sum + d.revenue, 0) / count) : 0,
    };
  });
}

/**
 * The history over `dates` (oldest first, every date present even with no sale). Orders outside the
 * range are ignored. Cancelled and demo orders must be left out by the caller.
 */
export function buildSalesHistory(orders: SaleOrder[], dates: string[]): SalesHistory {
  const days = new Map(dates.map((date) => [date, emptyDay(date)]));
  const products = new Map<string, ProductSales>();
  let completeOrders = 0;
  let completeRevenue = 0;
  let completeCost = 0;

  for (const order of orders) {
    const day = days.get(localDate(order.placedAt));
    if (!day) continue;
    addOrderToDay(day, order);
    if (order.incompleteLineCount === 0) {
      completeOrders += 1;
      completeRevenue += order.totalValue;
      completeCost += order.calculatedCost;
    }
    for (const item of order.items) {
      const key = item.code || item.name;
      const product = products.get(key) ?? { key, name: item.name, quantity: 0, orders: 0 };
      product.quantity += item.quantity;
      product.orders += 1;
      products.set(key, product);
    }
  }

  const list = [...days.values()].map((day) => ({
    ...day,
    revenue: round2(day.revenue),
    byChannel: Object.fromEntries(
      Object.entries(day.byChannel).map(([channel, v]) => [
        channel,
        { ...v, revenue: round2(v.revenue) },
      ]),
    ),
  }));
  const totalOrders = list.reduce((sum, day) => sum + day.orders, 0);
  const revenue = round2(list.reduce((sum, day) => sum + day.revenue, 0));

  return {
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
    days: list,
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 15),
    weekdays: weekdayAverages(list),
    totals: {
      orders: totalOrders,
      items: list.reduce((sum, day) => sum + day.items, 0),
      revenue,
      avgTicket: totalOrders ? round2(revenue / totalOrders) : 0,
      completeOrders,
      margin: completeRevenue > 0 ? (completeRevenue - completeCost) / completeRevenue : null,
    },
  };
}
