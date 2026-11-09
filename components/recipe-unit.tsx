import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';

/**
 * The unit next to a recipe quantity. For an ingredient that has a density (g per ml) it is a button
 * that switches between g and ml, so the kitchen can write what its scale or its jug reads; the saved
 * quantity is always in the ingredient's own unit (see `storedQuantity`).
 */
export function RecipeUnit({
  unit,
  gramsPerMl,
  typed,
  onSwitch,
}: {
  unit: string;
  gramsPerMl?: number;
  /** The unit being typed; the ingredient's own when absent. */
  typed?: string;
  onSwitch: (_next: 'g' | 'ml') => void;
}) {
  const copy = useCopy().rawIngredients.density;
  if ((unit !== 'g' && unit !== 'ml') || !gramsPerMl) {
    return <span className="w-8 text-xs text-muted-foreground">{unit}</span>;
  }
  const current = typed ?? unit;
  const next = current === 'g' ? 'ml' : 'g';
  return (
    <button
      type="button"
      className="w-8 text-left text-xs text-muted-foreground underline decoration-dotted"
      title={formatCopy(copy.switchHint, { unit: next, density: String(gramsPerMl) })}
      onClick={() => onSwitch(next)}
    >
      {current}
    </button>
  );
}
