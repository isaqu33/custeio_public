import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { computePriceReport, type PurchaseRow } from '@/app/lib/price-report';
import RawIngredientDB from '@/app/models/raw-ingredients';
import StockMovementDB from '@/app/models/stock-movements';

// "Preços de compra": which ingredients got more expensive with the same supplier, and where the
// same ingredient is bought from more than one supplier at different prices. Built from the purchase
// ledger, so it needs no recipe and no sale: the cost of buying is known the day the note arrives.

// A year of purchases is enough to find the previous price of anything bought regularly.
const LOOKBACK_DAYS = 365;
const MAX_ROWS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Src = {
  invoiceAccessKey?: string;
  manualBatchId?: string;
  itemIndex?: number;
  supplierCnpj?: string;
  supplierName?: string;
  invoiceNumber?: string;
};

// A purchase is identified by its invoice key, or by the entry id for a hand-typed one; a reversal
// carries the same source as what it undoes.
const keyOf = (source: Src) =>
  `${source.invoiceAccessKey ?? source.manualBatchId}:${source.itemIndex}`;

export type PriceUnit = 'g' | 'ml' | 'un';

export type PriceChangeItem = {
  ingredientId: string;
  name: string;
  unit: PriceUnit;
  supplierName: string;
  previous: { unitCost: number; at: string };
  latest: { unitCost: number; at: string; quantity: number; invoiceNumber?: string };
  percent: number;
  extraPaid: number;
};

export type SupplierComparisonItem = {
  ingredientId: string;
  name: string;
  unit: PriceUnit;
  prices: Array<{ supplierName: string; unitCost: number; at: string; quantity: number }>;
  spreadPercent: number;
};

export type PriceReportView = {
  changes: PriceChangeItem[];
  comparisons: SupplierComparisonItem[];
  /** The total the changes cost above the previous prices (negative: saved). */
  totalExtraPaid: number;
  windowDays: number;
};

async function loadLivePurchases(storeId: string): Promise<PurchaseRow[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
  const store = toObjectId(storeId);
  const [purchases, reversals] = await Promise.all([
    StockMovementDB.find({ storeId: store, type: 'purchase', occurredAt: { $gte: since } })
      .select('rawIngredientId occurredAt quantity unitCost source')
      .sort({ occurredAt: -1 })
      .limit(MAX_ROWS)
      .lean<LeanDoc[]>(),
    StockMovementDB.find({
      storeId: store,
      type: 'reversal',
      'source.itemIndex': { $exists: true },
    })
      .select('source.invoiceAccessKey source.manualBatchId source.itemIndex')
      .limit(MAX_ROWS)
      .lean<LeanDoc[]>(),
  ]);
  const reversed = new Set(reversals.map((doc) => keyOf((doc.source ?? {}) as Src)));

  return purchases
    .filter((doc) => !reversed.has(keyOf((doc.source ?? {}) as Src)))
    .map((doc) => {
      const source = (doc.source ?? {}) as Src;
      return {
        ingredientId: String(doc.rawIngredientId),
        occurredAt: doc.occurredAt as Date,
        quantity: Number(doc.quantity ?? 0),
        unitCost: Number(doc.unitCost ?? 0),
        supplierKey: source.supplierCnpj || source.supplierName || 'manual',
        supplierName: source.supplierName || '',
        invoiceNumber: source.invoiceNumber,
      };
    });
}

/** The price report of a store: who got dearer or cheaper, and who sells the same thing for less. */
export async function getPriceReportForStore(
  storeId: string,
  params: { windowDays?: number; minPercent?: number } = {},
): Promise<PriceReportView> {
  await connectDB();
  const windowDays = params.windowDays ?? 90;
  const rows = await loadLivePurchases(storeId);
  const report = computePriceReport(rows, {
    changeWindowDays: windowDays,
    minPercent: params.minPercent,
  });

  const ids = [
    ...new Set([...report.changes, ...report.comparisons].map((entry) => entry.ingredientId)),
  ];
  const ingredients = new Map(
    (
      await RawIngredientDB.find({ _id: { $in: toObjectIds(ids) }, storeId: toObjectId(storeId) })
        .select('name unit')
        .lean<LeanDoc[]>()
    ).map((doc) => [String(doc._id), doc]),
  );
  const nameOf = (id: string) => String(ingredients.get(id)?.name ?? '');
  const unitOf = (id: string) => (ingredients.get(id)?.unit as PriceUnit | undefined) ?? 'un';

  const changes = report.changes
    .filter((change) => ingredients.has(change.ingredientId))
    .map(
      (change): PriceChangeItem => ({
        ...change,
        name: nameOf(change.ingredientId),
        unit: unitOf(change.ingredientId),
        previous: { ...change.previous, at: change.previous.at.toISOString() },
        latest: { ...change.latest, at: change.latest.at.toISOString() },
      }),
    );
  const comparisons = report.comparisons
    .filter((entry) => ingredients.has(entry.ingredientId))
    .map(
      (entry): SupplierComparisonItem => ({
        ...entry,
        name: nameOf(entry.ingredientId),
        unit: unitOf(entry.ingredientId),
        prices: entry.prices.map((price) => ({ ...price, at: price.at.toISOString() })),
      }),
    );

  return {
    changes,
    comparisons,
    totalExtraPaid: Number(changes.reduce((sum, change) => sum + change.extraPaid, 0).toFixed(2)),
    windowDays,
  };
}
