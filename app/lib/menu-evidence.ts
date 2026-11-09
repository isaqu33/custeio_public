// Which lines of the store's menu look like a given ingredient, so the AI can be shown the few that
// matter ("Mamão" -> nothing on the menu; "Bacon Fatiado" -> "X-Bacon", "+ Bacon") instead of the whole
// menu, which can be any size. Pure and worker-safe.
import { foldText } from '@/app/lib/ingredient-identity';

export type MenuEntry = { label: string; type: 'product' | 'modifier' };

const STOPWORDS = new Set([
  'com',
  'sem',
  'para',
  'por',
  'dos',
  'das',
  'del',
  'tipo',
  'pacote',
  'caixa',
  'frasco',
  'unidade',
  'kg',
  'ml',
  'lt',
  'pct',
  'cx',
]);

/** The words of a name that say something: no numbers, units or filler, and singular. */
export function significantTokens(text: string): string[] {
  const tokens = foldText(text)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
    .map((token) => (token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
  return [...new Set(tokens)];
}

/**
 * The menu lines sharing at least one significant word with the ingredient, best first, at most `max`.
 * A line with the same label appearing under many products counts once.
 */
export function menuEvidenceFor(ingredientName: string, menu: MenuEntry[], max = 5): MenuEntry[] {
  const wanted = new Set(significantTokens(ingredientName));
  if (wanted.size === 0) return [];
  const seen = new Set<string>();
  const scored: Array<{ entry: MenuEntry; score: number }> = [];
  for (const entry of menu) {
    const key = `${entry.type}:${foldText(entry.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = significantTokens(entry.label).filter((token) => wanted.has(token)).length;
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, max)
    .map((item) => item.entry);
}

/** The names sharing a significant word with `name`, best first — for "is it a duplicate of one of these?". */
export function similarNames(name: string, names: string[], max = 8): string[] {
  return menuEvidenceFor(
    name,
    names.map((label) => ({ label, type: 'product' as const })),
    max,
  ).map((entry) => entry.label);
}
