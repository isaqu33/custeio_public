// Turning what a supplier typed on an NFe into a name and a kind for an
// ingredient. Pure and worker-safe: imported by the capture job and its tests.

export type IngredientKind = 'food' | 'packaging' | 'cleaning' | 'other';
export const INGREDIENT_KINDS: readonly IngredientKind[] = [
  'food',
  'packaging',
  'cleaning',
  'other',
];

/** Kinds that are part of what the store sells or serves — the ones stock alerts and CMV care about. */
export const OPERATIONAL_KINDS: readonly IngredientKind[] = ['food', 'packaging'];

export type OperationState = 'in' | 'out' | 'unconfirmed';

/**
 * Where an ingredient stands on being part of the operation:
 *  - an explicit decision (`inOperation`: the owner, or a confident AI) wins;
 *  - otherwise a kind that is not food/packaging is out;
 *  - a food/packaging item that came from an invoice and nobody reviewed (a draft) is `unconfirmed`,
 *    unless a recipe already uses it, which is proof enough that it is in;
 *  - a reviewed food/packaging item is in.
 */
export function operationState(
  row: { kind?: string | null; inOperation?: boolean | null; isDraft?: boolean | null },
  usedInRecipe: boolean,
): OperationState {
  if (typeof row.inOperation === 'boolean') return row.inOperation ? 'in' : 'out';
  if (!OPERATIONAL_KINDS.includes((row.kind ?? 'food') as IngredientKind)) return 'out';
  return row.isDraft && !usedInRecipe ? 'unconfirmed' : 'in';
}

/** An explicit decision (`inOperation`) wins; otherwise the kind decides. */
export function isInOperation(row: {
  kind?: string | null;
  inOperation?: boolean | null;
}): boolean {
  if (typeof row.inOperation === 'boolean') return row.inOperation;
  return OPERATIONAL_KINDS.includes((row.kind ?? 'food') as IngredientKind);
}

// The supplier's own unit suffix, glued or not: "UN", "UN01UN", "UN0-5KG", "UN01-2KG".
const UNIT_NOISE = /^(?:un(?:d|id|idade)?|un[\d-]+[a-z]*)$/i;
const PLAIN_UNIT = /^(?:un|und|unid|unidade)$/i;

/**
 * "ACUCAR CRISTAL PEROLA 5KG UN0-5KG" -> "Acucar Cristal Perola 5kg". An NFe's
 * xProd is conventionally all caps and ends in the supplier's unit code; both
 * are noise for a name a person reads. A real count survives: the "UN" in
 * "OVOS 30 UN" stays because a number sits right before it.
 */
export function cleanIngredientName(xProd: string): string {
  const tokens = xProd.trim().replace(/\s+/g, ' ').split(' ');
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1] ?? '';
    const previous = tokens[tokens.length - 2] ?? '';
    if (!UNIT_NOISE.test(last)) break;
    if (PLAIN_UNIT.test(last) && /^\d+$/.test(previous)) break;
    tokens.pop();
  }
  return tokens
    .join(' ')
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Keyword rules, checked in this order. Words, not substrings: "palito" must
// not make a bag of fries "packaging", "lixo" must not match "lixa". Deliberately
// short — a wrong guess is only a suggestion the owner can change, and nothing
// stronger than keywords is used (no AI here, see docs/features/sefaz-nfe.md Tier 4).
const OTHER =
  /\b(?:seda serum|desod|cr dent|creme dental|ap de barb|luva|bobina|shampoo|sabonete|papel higien|fosforo|pilha|lampada)\b/;
const PACKAGING =
  /\b(?:embalag\w*|sacola|copo|tampa|marmita|guardanapo|pote|papel p lanche|papel manteiga|papel aluminio|aluminio|filme pvc|canudo|isopor|bandeja)\b/;
const CLEANING =
  /\b(?:limp\w*|det|desinf\w*|deseng\w*|sabao|esponja|toalha de papel|inset\w*|ins baygon|baygon|amac|la de aco|palha de aco|alcool gel|agua sanit\w*|lava roupas|multiuso|cloro|desodorizador|saco de lixo|lixo)\b/;

/** A first guess at what an NFe line is. Defaults to food: most of what a restaurant buys. */
export function suggestIngredientKind(description: string): IngredientKind {
  const text = normalize(description);
  if (OTHER.test(text)) return 'other';
  if (PACKAGING.test(text)) return 'packaging';
  if (CLEANING.test(text)) return 'cleaning';
  return 'food';
}
