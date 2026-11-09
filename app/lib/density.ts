// g ↔ ml for ingredients that are both weighed and measured (a sauce stocked in ml that the kitchen
// weighs in grams). The density is per ingredient: there is no universal one. Pure and worker-safe.

export type MassVolumeUnit = 'g' | 'ml';

/** How much the ingredient's density can be trusted: typed by the owner, worked out from a recipe, or guessed. */
export type DensitySource = 'manual' | 'derived' | 'estimate';

/** 15 g at 1,15 g/ml is 13,04 ml. Null when either unit is not g/ml (a unit count has no density). */
export function convertMassVolume(
  value: number,
  from: string,
  to: string,
  gramsPerMl: number,
): number | null {
  if (!(gramsPerMl > 0)) return null;
  if (from === to && (from === 'g' || from === 'ml')) return value;
  if (from === 'g' && to === 'ml') return value / gramsPerMl;
  if (from === 'ml' && to === 'g') return value * gramsPerMl;
  return null;
}

export type DensityLine = { quantity: number; unit: string; gramsPerMl?: number };

// What a recipe may include that cannot be converted (a pinch of pepper, a unit) before the result stops
// being trustworthy, as a share of the batch.
const TOLERATED_SHARE = 0.02;

/**
 * The density of a preparation, from its own recipe: what went in (in grams) over what came out (in
 * ml), or the other way round. Only when the recipe really crosses units (a gram line for a ml yield)
 * and what cannot be converted is a rounding error of the batch; otherwise nothing is guessed.
 */
export function derivePreparationDensity(
  yieldUnit: string,
  yieldQuantity: number,
  lines: DensityLine[],
): number | undefined {
  if (!(yieldQuantity > 0) || (yieldUnit !== 'ml' && yieldUnit !== 'g')) return undefined;
  const other = yieldUnit === 'ml' ? 'g' : 'ml';
  let crossed = 0;
  let converted = 0;
  let unknown = 0;
  for (const line of lines) {
    if (line.unit === yieldUnit) converted += line.quantity;
    else if (line.unit === other) crossed += line.quantity;
    else unknown += line.quantity;
  }
  if (crossed <= 0 || unknown > yieldQuantity * TOLERATED_SHARE) return undefined;
  if (converted > yieldQuantity * TOLERATED_SHARE) return undefined;
  const grams = yieldUnit === 'ml' ? crossed : yieldQuantity;
  const millilitres = yieldUnit === 'ml' ? yieldQuantity : crossed;
  return Number((grams / millilitres).toFixed(4));
}

/** What goes into the ledger: the number typed in `typedUnit`, as the ingredient's own `storedUnit`. */
export function storedQuantity(
  typed: number,
  typedUnit: string | undefined,
  storedUnit: string,
  gramsPerMl: number | undefined,
): number {
  if (!typedUnit || typedUnit === storedUnit || !gramsPerMl) return typed;
  const converted = convertMassVolume(typed, typedUnit, storedUnit, gramsPerMl);
  return converted === null ? typed : Number(converted.toFixed(3));
}

/** The text of a field once its unit is switched, so the same amount stays on screen (13 ml ↔ 15 g). */
export function switchedText(text: string, from: string, to: string, gramsPerMl: number): string {
  const typed = Number(text.replace(',', '.'));
  if (!text.trim() || !Number.isFinite(typed)) return text;
  const converted = convertMassVolume(typed, from, to, gramsPerMl);
  return converted === null ? text : String(Number(converted.toFixed(2)));
}
