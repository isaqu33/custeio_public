// What an order takes out of stock: the recipe of each product sold plus the recipe of each
// complement, multiplied the way the PDV counts them. Pure on purpose — the lookups (which recipe
// belongs to which PDV code) are handed in, so the rule itself can be tested without a database.
//
// Quantities (checked on real orders, docs/features/alloy-api.md): a line's `quantity` multiplies
// its product and every complement under it; a complement can have its own quantity ("Fritas
// Combo" × 3 inside a combo); the same complement code can be listed several times in one line.

export type RecipeLine = { rawIngredientId: string; quantity: number };

export type ConsumptionItem = {
  externalCode: string;
  name: string;
  quantity: number;
  modifiers: Array<{ externalCode: string; name: string; quantity: number }>;
};

export type Recipes = {
  /** The product's recipe lines, or `undefined` when it has none (no ficha técnica yet). */
  product: (_item: ConsumptionItem) => RecipeLine[] | undefined;
  /**
   * The complement's recipe, or `undefined` when nobody said what it uses. An empty array is an
   * answer: it consumes nothing (a doneness like "Ao Ponto").
   */
  modifier: (_modifier: ConsumptionItem['modifiers'][number]) => RecipeLine[] | undefined;
};

export type MissingRecipe = { kind: 'product' | 'modifier'; codPdv: string; name: string };

export type OrderConsumption = {
  /** Ingredient id → quantity in the ingredient's own unit. */
  lines: Map<string, number>;
  /** Products and complements that had no recipe, once each. */
  missing: MissingRecipe[];
};

export function computeOrderConsumption(
  items: ConsumptionItem[],
  recipes: Recipes,
): OrderConsumption {
  const lines = new Map<string, number>();
  const missing = new Map<string, MissingRecipe>();
  const add = (recipe: RecipeLine[], times: number) => {
    for (const line of recipe) {
      lines.set(
        line.rawIngredientId,
        (lines.get(line.rawIngredientId) ?? 0) + line.quantity * times,
      );
    }
  };

  for (const item of items) {
    const product = recipes.product(item);
    if (product && product.length > 0) add(product, item.quantity);
    else {
      missing.set(`product|${item.externalCode}|${item.name}`, {
        kind: 'product',
        codPdv: item.externalCode,
        name: item.name,
      });
    }

    for (const modifier of item.modifiers) {
      const recipe = recipes.modifier(modifier);
      if (recipe === undefined) {
        missing.set(`modifier|${modifier.externalCode}|${modifier.name}`, {
          kind: 'modifier',
          codPdv: modifier.externalCode,
          name: modifier.name,
        });
      } else add(recipe, item.quantity * modifier.quantity);
    }
  }

  // Float dust from sums like 0.1 × 3 is not a quantity anyone stocks.
  for (const [id, quantity] of lines) lines.set(id, Number(quantity.toFixed(3)));
  return { lines, missing: [...missing.values()] };
}

/** What the PDV charged for the lines: unit price × quantity, complements included. */
export function itemsRevenue(
  items: Array<{
    price: number;
    quantity: number;
    modifiers: Array<{ price: number; quantity: number }>;
  }>,
): number {
  const total = items.reduce(
    (sum, item) =>
      sum +
      item.quantity *
        (item.price + item.modifiers.reduce((inner, m) => inner + m.price * m.quantity, 0)),
    0,
  );
  return Number(total.toFixed(2));
}

/** Alloy's timestamps are naive local time ("2026-10-02 20:14:06", America/Sao_Paulo, UTC-3). */
export function parseLocalTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
