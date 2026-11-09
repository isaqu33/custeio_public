import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { UnprocessableEntityError } from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import { containsCondition } from '@/app/lib/search-regex';
import { computeProductEconomics, type ProductRecipeLine } from '@/app/lib/services/products';
import type { RawIngredientUnit } from '@/app/lib/services/raw-ingredients';
import { loadSharedRecipes, saveSharedRecipe } from '@/app/lib/services/shared-recipes';
import PartnerProductDB from '@/app/models/partner-products';
import RawIngredientDB from '@/app/models/raw-ingredients';

// A complement ("Blend Angus (100g)", "Molho Verde", "Fritas Combo") as the store sells it:
// one entry per PDV code, however many products offer it. The catalog repeats the same
// complement under every product, with different ids but the same code, and an order's
// complements carry only that code — so the recipe is kept per code (shared-recipes.ts).
export type ModifierListItem = {
  codPdv: string;
  name: string;
  /** The groups it appears in ("Adicionais", "Molho"…). */
  groups: string[];
  /** What it sells for; a range when products price it differently. */
  priceMin: number;
  priceMax: number;
  /** How many active products offer it. */
  productsCount: number;
  /** A recipe was saved for it — possibly an empty one, meaning "consumes nothing". */
  configured: boolean;
  recipe: ProductRecipeLine[];
  cost?: number;
  costIncomplete: boolean;
};

type ModifierRow = {
  _id: string;
  names: string[];
  groups: string[];
  prices: number[];
  products: unknown[];
};

const EXPORT_LIMIT = 5000;

/**
 * Every complement of a store's ACTIVE products, grouped by PDV code. Complements with no
 * code cannot be matched to an order, so they are left out (and counted by the caller if
 * it ever needs to).
 */
export async function getModifiersForStore(
  storeId: string,
  params: { q?: string } = {},
): Promise<ModifierListItem[]> {
  await connectDB();
  const store = toObjectId(storeId);
  const term = params.q?.trim();

  const rows = await PartnerProductDB.aggregate<ModifierRow>([
    { $match: { storeId: store, isActive: true } },
    { $unwind: '$modifiers' },
    { $match: { 'modifiers.codPdv': { $exists: true, $ne: '' } } },
    ...(term ? [{ $match: { 'modifiers.name': containsCondition(term) } }] : []),
    {
      $group: {
        _id: '$modifiers.codPdv',
        names: { $addToSet: '$modifiers.name' },
        groups: { $addToSet: '$modifiers.group' },
        prices: { $addToSet: '$modifiers.price' },
        products: { $addToSet: '$_id' },
      },
    },
    { $limit: EXPORT_LIMIT },
  ]);

  const shared = await loadSharedRecipes(
    storeId,
    'modifier',
    rows.map((row) => row._id),
  );
  const ingredientIds = [
    ...new Set(
      [...shared.values()].flatMap((lines) => lines.map((l) => String(l.rawIngredientId))),
    ),
  ];
  const ingredients = new Map(
    (ingredientIds.length > 0
      ? await RawIngredientDB.find({ _id: { $in: toObjectIds(ingredientIds) } })
          .select('name unit averageCost')
          .lean()
      : []
    ).map((doc: LeanDoc) => [
      String(doc._id),
      {
        name: String(doc.name ?? ''),
        unit: doc.unit as RawIngredientUnit,
        averageCost: Number(doc.averageCost ?? 0),
      },
    ]),
  );

  return rows
    .map((row) => {
      const lines = shared.get(row._id);
      const recipe: ProductRecipeLine[] = (lines ?? []).map((line) => {
        const id = String(line.rawIngredientId);
        const info = ingredients.get(id);
        return {
          rawIngredientId: id,
          name: info?.name ?? '',
          unit: info?.unit ?? 'un',
          quantity: Number(line.quantity),
        };
      });
      const economics = computeProductEconomics(
        0,
        recipe.map((line) => ({
          quantity: line.quantity,
          averageCost: ingredients.get(line.rawIngredientId)?.averageCost,
        })),
      );
      const prices = row.prices.length > 0 ? row.prices : [0];
      return {
        codPdv: row._id,
        name: [...row.names].sort((a, b) => a.length - b.length)[0] ?? row._id,
        groups: [...row.groups].filter(Boolean).sort(),
        priceMin: Math.min(...prices),
        priceMax: Math.max(...prices),
        productsCount: row.products.length,
        configured: lines !== undefined,
        recipe,
        cost: economics.cost,
        costIncomplete: economics.costIncomplete,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Saves a complement's recipe under its PDV code. An empty recipe is a valid answer: it
 * records "this complement consumes nothing" (a doneness like "Ao Ponto"), which is not the
 * same as "nobody filled it in yet". Every ingredient must belong to the store.
 */
export async function updateModifierRecipe(input: {
  storeId: string;
  codPdv: string;
  recipe: Array<{ rawIngredientId: string; quantity: number }>;
}): Promise<void> {
  await connectDB();
  const ids = input.recipe.map((line) => line.rawIngredientId);
  if (new Set(ids).size !== ids.length) {
    throw new UnprocessableEntityError('An ingredient can appear only once in a recipe.');
  }
  if (ids.length > 0) {
    const found = await RawIngredientDB.countDocuments({
      _id: { $in: toObjectIds(ids) },
      storeId: toObjectId(input.storeId),
    });
    if (found !== ids.length) {
      throw new UnprocessableEntityError('Every ingredient must belong to this store.');
    }
  }
  await saveSharedRecipe({ ...input, kind: 'modifier' });
}

export type ModifiersPage = {
  data: ModifierListItem[];
  total: number;
  page: number;
  totalPages: number;
};

/** One page of {@link getModifiersForStore}: a store has a few dozen complements, so it pages in memory. */
export async function getModifiersPageForStore(
  storeId: string,
  params: { page?: number; limit?: number; q?: string } = {},
): Promise<ModifiersPage> {
  const all = await getModifiersForStore(storeId, { q: params.q });
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 20;
  return {
    data: all.slice((page - 1) * limit, page * limit),
    total: all.length,
    page,
    totalPages: totalPages(all.length, limit),
  };
}
