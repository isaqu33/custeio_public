import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { type AttentionItem, buildAttentionItems } from '@/app/lib/attention';
import { operationState } from '@/app/lib/ingredient-naming';
import { toObjectId } from '@/app/lib/mongo-id';
import {
  getIngredientIdsInRecipes,
  getIngredientUsageCounts,
} from '@/app/lib/services/ingredient-usage';
import { getMissingRecipesForStore, getOrdersSummaryForStore } from '@/app/lib/services/orders';
import { getPriceReportForStore } from '@/app/lib/services/price-report';
import { getSalesHistoryForStore } from '@/app/lib/services/sales-history';
import { getStockSummaryForStore } from '@/app/lib/services/stock-summary';
import RawIngredientDB from '@/app/models/raw-ingredients';

// The tenant's landing page: four numbers the finished product leads with, and the exceptions that
// need a decision. Everything here is read from what other services already compute.

const SALES_DAYS = 30;
const PRICE_DAYS = 14;

export type DashboardData = {
  tiles: {
    stockValue: number;
    lowStock: number;
    /** Over the complete orders of the last 30 days; null while there is none. */
    margin: number | null;
    cmv: number | null;
    completeOrders: number;
    orders: number;
  };
  attention: AttentionItem[];
};

type IngredientRow = LeanDoc & {
  name?: string;
  unit?: string;
  currentStock?: number;
  averageCost?: number;
  minAlertStock?: number;
  kind?: string;
  inOperation?: boolean;
  isDraft?: boolean;
  preparation?: unknown;
};

/** Operational ingredients below zero (not the preparations, which have their own item). */
function negativeStock(rows: IngredientRow[], isOperational: (_row: IngredientRow) => boolean) {
  const negative = rows
    .filter((row) => isOperational(row) && !row.preparation && Number(row.currentStock) < 0)
    .map((row) => ({
      name: String(row.name),
      value: Math.abs(Number(row.currentStock)) * Number(row.averageCost ?? 0),
    }))
    .sort((a, b) => b.value - a.value);
  return {
    count: negative.length,
    value: negative.reduce((sum, row) => sum + row.value, 0),
    examples: negative.map((row) => row.name),
  };
}

async function loadIngredients(storeId: string): Promise<IngredientRow[]> {
  return RawIngredientDB.find({ storeId: toObjectId(storeId) })
    .select('name unit currentStock averageCost minAlertStock kind inOperation isDraft preparation')
    .lean<IngredientRow[]>();
}

export async function getDashboardForStore(storeId: string): Promise<DashboardData> {
  await connectDB();
  const [stock, sales, orders, missing, rows, usage, recipeIds, prices] = await Promise.all([
    getStockSummaryForStore(storeId),
    getSalesHistoryForStore(storeId, { days: SALES_DAYS }),
    getOrdersSummaryForStore(storeId),
    getMissingRecipesForStore(storeId, 3),
    loadIngredients(storeId),
    getIngredientUsageCounts(storeId),
    getIngredientIdsInRecipes(storeId),
    getPriceReportForStore(storeId, { windowDays: PRICE_DAYS }),
  ]);

  // An invoice draft nobody reviewed is not counted until a recipe uses it (see `operationState`).
  const isOperational = (row: IngredientRow) =>
    operationState(row, recipeIds.has(String(row._id))) === 'in';
  const operational = rows.filter(isOperational);
  const priceUp = prices.changes.filter((change) => change.extraPaid > 0);
  const attention = buildAttentionItems({
    missingRecipes: {
      count: missing.length,
      revenue: orders.incompleteRevenue,
      examples: missing.map((row) => row.name),
    },
    negativeStock: negativeStock(rows, isOperational),
    emptyPreparations: (() => {
      const empty = operational.filter((row) => row.preparation && Number(row.currentStock) <= 0);
      return { count: empty.length, examples: empty.map((row) => String(row.name)) };
    })(),
    noCost: (() => {
      const free = operational.filter(
        (row) => Number(row.averageCost ?? 0) <= 0 && (usage.get(String(row._id)) ?? 0) > 0,
      );
      return { count: free.length, examples: free.map((row) => String(row.name)) };
    })(),
    priceUp: {
      count: priceUp.length,
      value: priceUp.reduce((sum, change) => sum + change.extraPaid, 0),
      examples: priceUp.map((change) => `${change.name} +${change.percent.toFixed(0)}%`),
    },
    lowStock: {
      count: stock.lowStock,
      examples: operational
        .filter(
          (row) =>
            Number(row.minAlertStock) > 0 && Number(row.currentStock) <= Number(row.minAlertStock),
        )
        .map((row) => String(row.name)),
    },
    drafts: { count: stock.drafts },
  });

  return {
    tiles: {
      stockValue: stock.stockValue,
      lowStock: stock.lowStock,
      margin: sales.totals.margin,
      cmv: sales.totals.margin === null ? null : 1 - sales.totals.margin,
      completeOrders: sales.totals.completeOrders,
      orders: sales.totals.orders,
    },
    attention,
  };
}
