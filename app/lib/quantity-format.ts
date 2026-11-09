// How stock quantities and costs are SHOWN. Storage never changes: every
// ingredient is kept in g, ml or un (docs/features/stock.md). But "5000 g" and
// "R$ 0,0025 / g" are a machine's numbers; an owner reads "5 kg" and "R$ 2,50 / kg".

export type StockUnit = 'g' | 'ml' | 'un';

/** The unit people read and type in, and how many stock units make one of it. */
const DISPLAY: Record<StockUnit, { label: string; factor: number }> = {
  g: { label: 'kg', factor: 1000 },
  ml: { label: 'L', factor: 1000 },
  un: { label: 'un', factor: 1 },
};

export function displayUnit(unit: StockUnit) {
  return DISPLAY[unit];
}

/** Stock quantity → the number shown in the display unit ("5000 g" → 5). */
export function toDisplayQuantity(value: number, unit: StockUnit): number {
  return value / DISPLAY[unit].factor;
}

/** The number typed in the display unit → the stock quantity to store (5 → 5000 g). */
export function fromDisplayQuantity(value: number, unit: StockUnit): number {
  return roundQuantity(value * DISPLAY[unit].factor);
}

/** Stock quantities have no use for more than 3 decimals (1 g); this also drops float dust. */
export function roundQuantity(value: number): number {
  return Number(value.toFixed(3));
}

/** Cost per stock unit rounded to 8 decimals: enough for R$ 0,00000001/g, and no float noise. */
export function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

const number = (maximumFractionDigits: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits });

/**
 * "5 kg", "500 g", "1,5 L", "250 ml", "12 un". Switches to kg/L from 1000; keeps
 * grams and millilitres below that so a 250 g balance is not "0,25 kg".
 */
export function formatQuantity(value: number, unit: StockUnit): string {
  const abs = Math.abs(value);
  if (unit !== 'un' && abs >= 1000) {
    return `${number(3).format(toDisplayQuantity(value, unit))} ${DISPLAY[unit].label}`;
  }
  return `${number(3).format(value)} ${unit}`;
}

const currency = (maximumFractionDigits: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });

/** "R$ 2,50 / kg", "R$ 4,89 / L", "R$ 1,29 / un" — the cost per stock unit, per the unit people read. */
export function formatUnitCost(costPerStockUnit: number, unit: StockUnit): string {
  const perDisplay = costPerStockUnit * DISPLAY[unit].factor;
  return `${currency(perDisplay < 1 ? 4 : 2).format(perDisplay)} / ${DISPLAY[unit].label}`;
}

export function formatMoney(value: number): string {
  return currency(2).format(value);
}
