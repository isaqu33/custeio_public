import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import { loadSharedRecipes } from '@/app/lib/services/shared-recipes';
import PartnerProductDB from '@/app/models/partner-products';
import RawIngredientDB from '@/app/models/raw-ingredients';

type RecipeLine = { rawIngredientId: unknown };
type ProductRecipes = {
  codPdv?: string;
  recipe?: RecipeLine[];
  modifiers?: Array<{ codPdv?: string; recipe?: RecipeLine[] }>;
};

/**
 * How many ACTIVE products use each ingredient, counting the product's own
 * recipe and its complements' — the answer to "is this even part of what the
 * store sells?". A product counts once however many lines mention the ingredient.
 * Computed in memory: a store has hundreds of products, not millions.
 */
async function loadUsage(storeId: string): Promise<Map<string, number>> {
  await connectDB();
  const products = await PartnerProductDB.find({ storeId: toObjectId(storeId), isActive: true })
    .select('codPdv recipe modifiers.codPdv modifiers.recipe')
    .lean<Array<LeanDoc & ProductRecipes>>();

  // Recipes saved by PDV code take the place of a row's own (see shared-recipes.ts).
  const [sharedProducts, sharedModifiers] = await Promise.all([
    loadSharedRecipes(
      storeId,
      'product',
      products.map((product) => product.codPdv),
    ),
    loadSharedRecipes(
      storeId,
      'modifier',
      products.flatMap((product) => (product.modifiers ?? []).map((modifier) => modifier.codPdv)),
    ),
  ]);

  const counts = new Map<string, number>();
  for (const product of products) {
    const lines = [
      ...((product.codPdv && sharedProducts.get(product.codPdv)) || product.recipe || []),
      ...(product.modifiers ?? []).flatMap(
        (modifier) =>
          (modifier.codPdv && sharedModifiers.get(modifier.codPdv)) || modifier.recipe || [],
      ),
    ];
    for (const id of new Set(lines.map((line) => String(line.rawIngredientId)))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Ingredient id → number of active products that use it. Ingredients nobody uses are absent. */
export async function getIngredientUsageCounts(storeId: string): Promise<Map<string, number>> {
  return loadUsage(storeId);
}

/**
 * Every ingredient some recipe uses: a product's or complement's (the usage above) or a preparation's
 * ("Maionese Defumada" takes mayonnaise). Being in a recipe is proof that the store uses it.
 */
export async function getIngredientIdsInRecipes(storeId: string): Promise<Set<string>> {
  const ids = new Set((await loadUsage(storeId)).keys());
  const preparations = await RawIngredientDB.find({
    storeId: toObjectId(storeId),
    'preparation.lines.0': { $exists: true },
  })
    .select('preparation.lines.rawIngredientId')
    .lean<Array<{ preparation?: { lines?: RecipeLine[] } }>>();
  for (const doc of preparations) {
    for (const line of doc.preparation?.lines ?? []) ids.add(String(line.rawIngredientId));
  }
  return ids;
}
