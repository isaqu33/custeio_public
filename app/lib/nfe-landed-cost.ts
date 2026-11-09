// Shared by the XML and PDF NFe parsers: a purchase costs the same regardless
// of which format captured it (see docs/features/stock-and-cmv.md).

// An invoice total more than 50% away from its items is not freight and a
// discount, it is something we do not understand.
const MAX_ADJUSTMENT_SHARE = 0.5;

/**
 * Spreads what the invoice total adds on top of the items across the lines,
 * proportionally to each line's own base cost, so a R$ 13,55 freight or a
 * R$ 7,40 discount ends up in the cost of what it was paid for. Left alone
 * when the total is missing or disagrees wildly with the items (a partial or
 * odd invoice, or a PDF whose item table came back empty), or when there are
 * no items at all: an unexplained gap is not something to spread.
 */
export function allocateLandedValues(
  bases: number[],
  invoiceTotal: number,
): { landed: number[]; adjustments: number } {
  const itemsBase = bases.reduce((sum, base) => sum + base, 0);
  const residual = invoiceTotal - itemsBase;
  const plausible =
    invoiceTotal > 0 && itemsBase > 0 && Math.abs(residual) <= itemsBase * MAX_ADJUSTMENT_SHARE;
  if (!plausible) return { landed: bases, adjustments: 0 };
  return {
    landed: bases.map((base) => base + (residual * base) / itemsBase),
    adjustments: residual,
  };
}
