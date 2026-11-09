// What purchase prices did: which ingredient got more expensive (or cheaper) with the same supplier,
// and where the same ingredient is bought from more than one supplier at different prices. Pure and
// worker-safe: the service feeds it the live purchases (none that an invoice cancellation undid).

export type PurchaseRow = {
  ingredientId: string;
  occurredAt: Date;
  /** In the ingredient's own unit. */
  quantity: number;
  /** Landed cost per stock unit. */
  unitCost: number;
  /** CNPJ, or the name for a purchase typed in by hand: what tells two suppliers apart. */
  supplierKey: string;
  supplierName: string;
  invoiceNumber?: string;
};

export type PriceChange = {
  ingredientId: string;
  supplierName: string;
  previous: { unitCost: number; at: Date };
  latest: { unitCost: number; at: Date; quantity: number; invoiceNumber?: string };
  /** Positive: more expensive. */
  percent: number;
  /** What the latest purchase cost above (positive) or below (negative) the previous price. */
  extraPaid: number;
};

export type SupplierPrice = {
  supplierName: string;
  unitCost: number;
  at: Date;
  quantity: number;
};

export type SupplierComparison = {
  ingredientId: string;
  /** Cheapest first. */
  prices: SupplierPrice[];
  /** How much the dearest is above the cheapest, in %. */
  spreadPercent: number;
};

export type PriceReport = { changes: PriceChange[]; comparisons: SupplierComparison[] };

const DAY_MS = 24 * 60 * 60 * 1000;

export type PriceReportOptions = {
  now?: Date;
  /** Only changes whose latest purchase is this recent. */
  changeWindowDays?: number;
  /** Only suppliers bought from this recently take part in a comparison. */
  compareWindowDays?: number;
  /** Smaller moves (in %, either way) are noise. */
  minPercent?: number;
};

/** Purchases of one ingredient and supplier, newest first. */
function groupNewestFirst(rows: PurchaseRow[]): Map<string, PurchaseRow[]> {
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    if (!(row.unitCost > 0)) continue;
    const key = `${row.ingredientId}|${row.supplierKey}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const list of groups.values())
    list.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return groups;
}

function changeOf(list: PurchaseRow[], cutoff: number, minPercent: number): PriceChange | null {
  const [latest, previous] = list;
  if (!latest || !previous || latest.occurredAt.getTime() < cutoff) return null;
  const percent = (latest.unitCost / previous.unitCost - 1) * 100;
  if (Math.abs(percent) < minPercent) return null;
  return {
    ingredientId: latest.ingredientId,
    supplierName: latest.supplierName,
    previous: { unitCost: previous.unitCost, at: previous.occurredAt },
    latest: {
      unitCost: latest.unitCost,
      at: latest.occurredAt,
      quantity: latest.quantity,
      invoiceNumber: latest.invoiceNumber,
    },
    percent,
    extraPaid: (latest.unitCost - previous.unitCost) * latest.quantity,
  };
}

function comparisonsOf(groups: Map<string, PurchaseRow[]>, cutoff: number): SupplierComparison[] {
  const byIngredient = new Map<string, SupplierPrice[]>();
  for (const list of groups.values()) {
    const latest = list[0];
    if (!latest || latest.occurredAt.getTime() < cutoff) continue;
    byIngredient.set(latest.ingredientId, [
      ...(byIngredient.get(latest.ingredientId) ?? []),
      {
        supplierName: latest.supplierName,
        unitCost: latest.unitCost,
        at: latest.occurredAt,
        quantity: latest.quantity,
      },
    ]);
  }
  const out: SupplierComparison[] = [];
  for (const [ingredientId, prices] of byIngredient) {
    if (prices.length < 2) continue;
    prices.sort((a, b) => a.unitCost - b.unitCost);
    const cheapest = prices[0]?.unitCost ?? 0;
    const dearest = prices[prices.length - 1]?.unitCost ?? 0;
    out.push({ ingredientId, prices, spreadPercent: (dearest / cheapest - 1) * 100 });
  }
  return out.sort((a, b) => b.spreadPercent - a.spreadPercent);
}

export function computePriceReport(
  rows: PurchaseRow[],
  options: PriceReportOptions = {},
): PriceReport {
  const now = (options.now ?? new Date()).getTime();
  const groups = groupNewestFirst(rows);
  const changeCutoff = now - (options.changeWindowDays ?? 90) * DAY_MS;
  const compareCutoff = now - (options.compareWindowDays ?? 180) * DAY_MS;
  const minPercent = options.minPercent ?? 5;

  const changes = [...groups.values()]
    .map((list) => changeOf(list, changeCutoff, minPercent))
    .filter((change): change is PriceChange => change !== null)
    // Money first: what it cost (or saved) comes before how big the percentage looks.
    .sort((a, b) => Math.abs(b.extraPaid) - Math.abs(a.extraPaid));

  return { changes, comparisons: comparisonsOf(groups, compareCutoff) };
}
