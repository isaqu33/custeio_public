// Turns the AI's proposals of "these ingredients are the same" into the list shown to the owner:
// only confident ones, no drink merged with another size or sugar/zero, overlapping groups united.
// Pure and worker-safe.
import { foldText } from '@/app/lib/ingredient-identity';

export type DuplicateProposal = {
  keep: string;
  merge: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  shouldMerge: boolean;
};

export type DuplicateGroup = {
  keep: string;
  merge: string[];
  confidence: 'high' | 'medium';
  reason: string;
  /** Why it cannot be merged as is (different units, or "un" packs of different sizes); absent when ready. */
  convertFirst?: string;
};

const DRINK = /\b(refr\w*|ref\.\w*|coca|fanta|sprite|guarana|energ\w*|monster|suco|agua|cerveja)\b/;
const ZERO = /(z\/?acuc|zero|zr|s\/a|sem acucar|diet|light)/;

/**
 * What must be equal for two drinks to be the same product on the menu: size and sugar/zero. `null` for
 * something that is not a drink; a drink whose size is not in the name has no key and matches nothing.
 */
export function drinkKey(name: string): string | null {
  const folded = foldText(name);
  if (!DRINK.test(folded)) return null;
  const size = folded.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|lt)\b/);
  if (!size) return 'unknown-size';
  const liters =
    size[2] === 'ml'
      ? Number((size[1] as string).replace(',', '.')) / 1000
      : Number((size[1] as string).replace(',', '.'));
  return `${liters}l|${ZERO.test(folded) ? 'zero' : 'regular'}`;
}

/** The size printed in the name, as a number: g or ml (kg, l converted) or a count ("C/20", "30un"). */
export function packSizeOf(name: string): number | null {
  const folded = foldText(name);
  const measure = folded.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|lt|l)\b/);
  if (measure) {
    const value = Number((measure[1] as string).replace(',', '.'));
    return ['kg', 'l', 'lt'].includes(measure[2] as string) ? value * 1000 : value;
  }
  const count = folded.match(/c\/\s*(\d+)|(\d+)\s*(?:un|uni|und)\b/);
  return count ? Number(count[1] ?? count[2]) : null;
}

/** What stops a group from being merged right away, in the owner's words; undefined when nothing does. */
function conversionNeeded(
  names: string[],
  unitOf: (_name: string) => string | undefined,
): string | undefined {
  const units = new Set(names.map(unitOf));
  if (units.size > 1) return 'unidades diferentes';
  // A name with no size at all is unknown, not different: only the sizes that are printed disagree.
  const sizes = new Set(
    names
      .filter((n) => unitOf(n) === 'un')
      .map(packSizeOf)
      .filter((size) => size !== null),
  );
  return sizes.size > 1 ? 'embalagens de tamanhos diferentes contadas em "un"' : undefined;
}

const RANK = { high: 2, medium: 1 } as const;

export function consolidateDuplicateGroups(
  proposals: DuplicateProposal[],
  unitOf: (_name: string) => string | undefined = () => undefined,
): DuplicateGroup[] {
  // 1) confident, self-consistent proposals only; drinks must agree on size and sugar.
  const usable: Array<{
    names: string[];
    keep: string;
    confidence: 'high' | 'medium';
    reason: string;
  }> = [];
  for (const p of proposals) {
    if (!p.shouldMerge || p.confidence === 'low') continue;
    const keepKey = drinkKey(p.keep);
    const merge = p.merge.filter((name) => {
      const key = drinkKey(name);
      if (keepKey === null && key === null) return true;
      return keepKey !== null && keepKey === key && key !== 'unknown-size';
    });
    if (merge.length === 0) continue;
    usable.push({
      names: [p.keep, ...merge],
      keep: p.keep,
      confidence: p.confidence,
      reason: p.reason,
    });
  }

  // 2) groups that share an ingredient are one group.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const u of usable) {
    u.names.forEach((n) => parent.set(n, find(n)));
    u.names.slice(1).forEach((n) => parent.set(find(n), find(u.names[0] as string)));
  }
  const merged = new Map<string, typeof usable>();
  for (const u of usable) {
    const root = find(u.keep);
    merged.set(root, [...(merged.get(root) ?? []), u]);
  }

  return [...merged.values()].map((items) => {
    const keeps = new Map<string, number>();
    items.forEach((i) => keeps.set(i.keep, (keeps.get(i.keep) ?? 0) + 1));
    const keep = [...keeps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as string;
    const names = new Set(items.flatMap((i) => i.names));
    names.delete(keep);
    const lowest = items.reduce(
      (min, i) => (RANK[i.confidence] < RANK[min] ? i.confidence : min),
      'high' as 'high' | 'medium',
    );
    const merge = [...names].sort();
    const convertFirst = conversionNeeded([keep, ...merge], unitOf);
    return {
      keep,
      merge,
      confidence: lowest,
      reason: items[0]?.reason ?? '',
      ...(convertFirst && { convertFirst }),
    };
  });
}
