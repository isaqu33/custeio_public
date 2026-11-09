// "Precisa da sua atenção": what the owner should look at, shaped from numbers other services
// already compute. Exception driven (docs: product principles): a kind with nothing to report is
// simply absent, and money comes first when it can be said. Pure and worker-safe.

export type AttentionKind =
  | 'missing_recipes'
  | 'negative_stock'
  | 'empty_preparations'
  | 'no_cost'
  | 'price_up'
  | 'low_stock'
  | 'drafts';

export type AttentionItem = {
  kind: AttentionKind;
  count: number;
  /** R$ involved, when it can be said (revenue affected, what a price rise cost…). */
  value?: number;
  /** A few names to start with. */
  examples: string[];
};

export type AttentionInputs = {
  /** Products or complements sold without a recipe, and the revenue of the orders they sit in. */
  missingRecipes: { count: number; revenue: number; examples: string[] };
  /** Ingredients below zero, and by how much money the balance is "off". */
  negativeStock: { count: number; value: number; examples: string[] };
  /** Preparations (molhos) with no stock: nobody registered the batch. */
  emptyPreparations: { count: number; examples: string[] };
  /** Ingredients used in recipes that have no cost: every cost that depends on them is understated. */
  noCost: { count: number; examples: string[] };
  /** Prices that rose recently, and what the latest purchases cost above the old price. */
  priceUp: { count: number; value: number; examples: string[] };
  lowStock: { count: number; examples: string[] };
  /** Ingredients created from an NF-e that nobody reviewed yet. */
  drafts: { count: number };
};

const MAX_EXAMPLES = 3;
const round2 = (value: number) => Number(value.toFixed(2));

/**
 * The items to show, in the order that matters: what breaks the numbers most comes first. Anything
 * with a count of zero is left out, so an empty list means "all good".
 */
export function buildAttentionItems(inputs: AttentionInputs): AttentionItem[] {
  const candidates: AttentionItem[] = [
    {
      kind: 'missing_recipes',
      count: inputs.missingRecipes.count,
      value: round2(inputs.missingRecipes.revenue),
      examples: inputs.missingRecipes.examples,
    },
    {
      kind: 'negative_stock',
      count: inputs.negativeStock.count,
      value: round2(inputs.negativeStock.value),
      examples: inputs.negativeStock.examples,
    },
    {
      kind: 'empty_preparations',
      count: inputs.emptyPreparations.count,
      examples: inputs.emptyPreparations.examples,
    },
    { kind: 'no_cost', count: inputs.noCost.count, examples: inputs.noCost.examples },
    {
      kind: 'price_up',
      count: inputs.priceUp.count,
      value: round2(inputs.priceUp.value),
      examples: inputs.priceUp.examples,
    },
    { kind: 'low_stock', count: inputs.lowStock.count, examples: inputs.lowStock.examples },
    { kind: 'drafts', count: inputs.drafts.count, examples: [] },
  ];
  return candidates
    .filter((item) => item.count > 0)
    .map((item) => ({ ...item, examples: item.examples.slice(0, MAX_EXAMPLES) }));
}
