import type { LeanDoc } from '@/app/lib/mongoose-types';
import { toObjectId } from '@/app/lib/mongo-id';
import ProductRecipeDB from '@/app/models/product-recipes';

export type RecipeKind = 'product' | 'modifier';
export type SharedRecipeLine = { rawIngredientId: unknown; quantity: number };

/**
 * The recipes saved by PDV code (see models/product-recipes.ts), as code → lines.
 * Codes with no saved recipe are absent.
 */
export async function loadSharedRecipes(
  storeId: string,
  kind: RecipeKind,
  codes: Array<string | undefined>,
): Promise<Map<string, SharedRecipeLine[]>> {
  const unique = [...new Set(codes.filter((code): code is string => Boolean(code)))];
  if (unique.length === 0) return new Map();
  const docs = await ProductRecipeDB.find({
    storeId: toObjectId(storeId),
    kind,
    codPdv: { $in: unique },
  })
    .select('codPdv recipe')
    .lean<Array<LeanDoc & { codPdv: string; recipe?: SharedRecipeLine[] }>>();
  return new Map(docs.map((doc) => [doc.codPdv, doc.recipe ?? []]));
}

/** Replaces the recipe saved under a PDV code, creating it the first time. */
export async function saveSharedRecipe(input: {
  storeId: string;
  kind: RecipeKind;
  codPdv: string;
  recipe: Array<{ rawIngredientId: string; quantity: number }>;
}): Promise<void> {
  await ProductRecipeDB.updateOne(
    { storeId: toObjectId(input.storeId), kind: input.kind, codPdv: input.codPdv },
    {
      $set: {
        recipe: input.recipe.map((line) => ({
          rawIngredientId: toObjectId(line.rawIngredientId),
          quantity: line.quantity,
        })),
      },
    },
    { upsert: true },
  );
}
