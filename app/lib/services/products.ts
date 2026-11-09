import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { NotFoundError, UnprocessableEntityError } from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import { containsCondition } from '@/app/lib/search-regex';
import type { RawIngredientUnit } from '@/app/lib/services/raw-ingredients';
import { loadSharedRecipes, saveSharedRecipe } from '@/app/lib/services/shared-recipes';
import PartnerProductDB from '@/app/models/partner-products';
import RawIngredientDB from '@/app/models/raw-ingredients';

export type ProductStatusFilter = 'active' | 'inactive' | 'all';

export type ProductRecipeLine = {
  rawIngredientId: string;
  name: string;
  unit: RawIngredientUnit;
  quantity: number;
};

export type ProductListItem = {
  _id: string;
  externalId: string;
  name: string;
  categoryName: string;
  /** The store's own menu, or an item a marketplace (iFood, DiDi) sent. */
  channel: 'own' | 'ifood' | 'didifood';
  codPdv?: string;
  sellingPrice: number;
  promotionalPrice?: number;
  /** What it actually sells for now: the promotional price while one is on. */
  price: number;
  isActive: boolean;
  modifiersCount: number;
  recipe: ProductRecipeLine[];
  /** Σ quantity × average cost; absent until there is a recipe. */
  cost?: number;
  /** A line points at an ingredient with no cost yet (or a deleted one): the cost is a floor. */
  costIncomplete: boolean;
  margin?: number;
  marginPercent?: number;
};

export type ProductsPage = {
  data: ProductListItem[];
  total: number;
  page: number;
  totalPages: number;
};

type IngredientInfo = { name: string; unit: RawIngredientUnit; averageCost: number };
type RecipeLineDoc = { rawIngredientId: unknown; quantity: number };
type ProductDoc = LeanDoc & { recipe?: RecipeLineDoc[]; modifiers?: unknown[] };

const LIST_FIELDS =
  'storeId externalId name categoryName channel codPdv sellingPrice promotionalPrice isActive recipe modifiers.externalId';
const EXPORT_LIMIT = 5000;

/** Cost and margin of one product from its recipe lines. Pure, so it is the one place these are defined. */
export function computeProductEconomics(
  price: number,
  lines: Array<{ quantity: number; averageCost?: number }>,
): Pick<ProductListItem, 'cost' | 'costIncomplete' | 'margin' | 'marginPercent'> {
  if (lines.length === 0) return { costIncomplete: false };
  const cost = lines.reduce((sum, line) => sum + line.quantity * (line.averageCost ?? 0), 0);
  const costIncomplete = lines.some((line) => !(line.averageCost && line.averageCost > 0));
  const margin = price - cost;
  return {
    cost,
    costIncomplete,
    margin,
    marginPercent: price > 0 ? (margin / price) * 100 : undefined,
  };
}

async function loadIngredients(ids: unknown[]): Promise<Map<string, IngredientInfo>> {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return new Map();
  const docs = await RawIngredientDB.find({ _id: { $in: toObjectIds(unique) } })
    .select('name unit averageCost')
    .lean();
  return new Map(
    docs.map((doc: LeanDoc) => [
      String(doc._id),
      {
        name: String(doc.name ?? ''),
        unit: doc.unit as RawIngredientUnit,
        averageCost: Number(doc.averageCost ?? 0),
      },
    ]),
  );
}

function toListItem(doc: ProductDoc, ingredients: Map<string, IngredientInfo>): ProductListItem {
  const sellingPrice = Number(doc.sellingPrice ?? 0);
  const promotionalPrice =
    typeof doc.promotionalPrice === 'number' ? doc.promotionalPrice : undefined;
  const price = promotionalPrice ?? sellingPrice;

  // A line whose ingredient no longer exists is kept visible (as a nameless,
  // costless line) rather than silently dropped from the recipe.
  const recipe = (doc.recipe ?? []).map((line) => {
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
    price,
    recipe.map((line) => ({
      quantity: line.quantity,
      averageCost: ingredients.get(line.rawIngredientId)?.averageCost,
    })),
  );

  return {
    _id: String(doc._id),
    externalId: String(doc.externalId ?? ''),
    name: String(doc.name ?? ''),
    categoryName: String(doc.categoryName ?? ''),
    channel: doc.channel === 'ifood' || doc.channel === 'didifood' ? doc.channel : 'own',
    codPdv: doc.codPdv ? String(doc.codPdv) : undefined,
    sellingPrice,
    promotionalPrice,
    price,
    isActive: doc.isActive !== false,
    modifiersCount: doc.modifiers?.length ?? 0,
    recipe,
    ...economics,
  };
}

function buildQuery(storeId: string, params: { q?: string; status?: ProductStatusFilter }) {
  const term = params.q?.trim();
  return {
    storeId: toObjectId(storeId),
    ...(params.status === 'active' && { isActive: true }),
    ...(params.status === 'inactive' && { isActive: false }),
    ...(term && { name: containsCondition(term) }),
  };
}

/**
 * A product's recipe is the one saved under its PDV code when there is one — shared by
 * every catalog copy of it — and its own row's recipe otherwise (a product the PDV gives
 * no code, or one saved before codes were used).
 */
async function withSharedRecipes(docs: ProductDoc[]): Promise<ProductDoc[]> {
  const byStore = new Map<string, ProductDoc[]>();
  for (const doc of docs) {
    const key = String(doc.storeId);
    byStore.set(key, [...(byStore.get(key) ?? []), doc]);
  }
  const shared = new Map<string, Map<string, RecipeLineDoc[]>>();
  for (const [storeId, group] of byStore) {
    shared.set(
      storeId,
      await loadSharedRecipes(
        storeId,
        'product',
        group.map((doc) => (doc.codPdv ? String(doc.codPdv) : undefined)),
      ),
    );
  }
  return docs.map((doc) => {
    const own = doc.codPdv ? shared.get(String(doc.storeId))?.get(String(doc.codPdv)) : undefined;
    return own ? { ...doc, recipe: own } : doc;
  });
}

async function hydrate(source: ProductDoc[]): Promise<ProductListItem[]> {
  const docs = await withSharedRecipes(source);
  const ingredients = await loadIngredients(
    docs.flatMap((doc) => (doc.recipe ?? []).map((line) => line.rawIngredientId)),
  );
  return docs.map((doc) => toListItem(doc, ingredients));
}

export type RecipeCopySource = {
  _id: string;
  name: string;
  recipe: Array<{ rawIngredientId: string; quantity: number }>;
};

/**
 * The products that already have a recipe, for "copy the recipe of another product": the X and its
 * "X + Fritas" differ only by the fries, which live in a complement, so one recipe serves both.
 * Active products only, resolved the same way the table shows them (PDV-code recipe first).
 */
export async function getRecipeCopySourcesForStore(storeId: string): Promise<RecipeCopySource[]> {
  await connectDB();
  const docs = await PartnerProductDB.find({ ...buildQuery(storeId, { status: 'active' }) })
    .select(LIST_FIELDS)
    .sort({ name: 1 })
    .limit(EXPORT_LIMIT)
    .lean<ProductDoc[]>();
  const products = await hydrate(docs);
  return products
    .filter((product) => product.recipe.length > 0)
    .map((product) => ({
      _id: product._id,
      name: product.name,
      recipe: product.recipe.map((line) => ({
        rawIngredientId: line.rawIngredientId,
        quantity: line.quantity,
      })),
    }));
}

/** One page of a store's products for the Produtos table, with cost and margin from the recipes. */
export async function getProductsPageForStore(
  storeId: string,
  params: { page?: number; limit?: number; q?: string; status?: ProductStatusFilter } = {},
): Promise<ProductsPage> {
  await connectDB();
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 20;
  const query = buildQuery(storeId, params);

  const [docs, total] = await Promise.all([
    PartnerProductDB.find(query)
      .select(LIST_FIELDS)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<ProductDoc[]>(),
    PartnerProductDB.countDocuments(query),
  ]);

  return { data: await hydrate(docs), total, page, totalPages: totalPages(total, limit) };
}

/** Every product matching the filters, for the CSV export. */
export async function getAllProductsForStore(
  storeId: string,
  params: { q?: string; status?: ProductStatusFilter } = {},
): Promise<ProductListItem[]> {
  await connectDB();
  const docs = await PartnerProductDB.find(buildQuery(storeId, params))
    .select(LIST_FIELDS)
    .sort({ name: 1 })
    .limit(EXPORT_LIMIT)
    .lean<ProductDoc[]>();
  return hydrate(docs);
}

export type ProductsSummary = {
  activeProducts: number;
  inactiveProducts: number;
  withRecipe: number;
  withoutRecipe: number;
  averagePrice: number;
  /** Mean margin (%) over active products whose recipe cost is complete; undefined when none. */
  averageMarginPercent?: number;
  lastSeenAt?: string;
};

/**
 * Store-wide numbers for the strip above the Produtos table. Computed over the
 * whole store — a search or page does not change them. Averages count only
 * active products: the hidden iFood copies would otherwise dominate.
 */
export async function getProductsSummaryForStore(storeId: string): Promise<ProductsSummary> {
  await connectDB();
  const store = toObjectId(storeId);
  const [docs, inactiveProducts] = await Promise.all([
    PartnerProductDB.find({ storeId: store, isActive: true })
      .select('storeId codPdv sellingPrice promotionalPrice recipe lastSeenAt')
      .lean<Array<ProductDoc & { lastSeenAt?: Date }>>(),
    PartnerProductDB.countDocuments({ storeId: store, isActive: false }),
  ]);

  const items = await hydrate(docs);
  const withRecipe = items.filter((item) => item.recipe.length > 0);
  const margins = withRecipe
    .filter((item) => !item.costIncomplete && item.marginPercent !== undefined)
    .map((item) => item.marginPercent as number);
  const lastSeen = docs.reduce<Date | undefined>(
    (latest, doc) =>
      doc.lastSeenAt && (!latest || doc.lastSeenAt > latest) ? doc.lastSeenAt : latest,
    undefined,
  );

  return {
    activeProducts: items.length,
    inactiveProducts,
    withRecipe: withRecipe.length,
    withoutRecipe: items.length - withRecipe.length,
    averagePrice: items.length
      ? items.reduce((sum, item) => sum + item.price, 0) / items.length
      : 0,
    averageMarginPercent: margins.length
      ? margins.reduce((sum, value) => sum + value, 0) / margins.length
      : undefined,
    lastSeenAt: lastSeen?.toISOString(),
  };
}

/** Resolves the owning store of a product — routes run the store → organization check before trusting `id`. */
export async function getProductStoreId(id: string): Promise<string | null> {
  await connectDB();
  const doc = await PartnerProductDB.findById(toObjectId(id)).select('storeId').lean();
  return doc ? String((doc as LeanDoc).storeId) : null;
}

export type RecipeIngredientOption = {
  _id: string;
  name: string;
  unit: RawIngredientUnit;
  /** So the recipe editor can show the estimated cost while it is being edited. */
  averageCost: number;
  /** Nicknames and barcodes: what the pickers search besides the name. */
  aliases: string[];
  barcodes: string[];
  /** Grams per ml, when known: lets the recipe be typed in g for an ingredient kept in ml (or the reverse). */
  gramsPerMl?: number;
};

/** The store's ingredients, for the recipe editor's picker. */
export async function getRecipeIngredientOptions(
  storeId: string,
): Promise<RecipeIngredientOption[]> {
  await connectDB();
  const docs = await RawIngredientDB.find({ storeId: toObjectId(storeId) })
    .select('name unit averageCost aliases barcodes density')
    .sort({ name: 1 })
    .limit(EXPORT_LIMIT)
    .lean();
  return docs.map((doc: LeanDoc) => ({
    _id: String(doc._id),
    name: String(doc.name ?? ''),
    unit: doc.unit as RawIngredientUnit,
    averageCost: Number(doc.averageCost ?? 0),
    aliases: ((doc.aliases as string[] | undefined) ?? []).map(String),
    barcodes: ((doc.barcodes as string[] | undefined) ?? []).map(String),
    gramsPerMl: (doc.density as { gramsPerMl?: number } | undefined)?.gramsPerMl,
  }));
}

/**
 * Replaces a product's recipe ("ficha técnica"). Alloy has no concept of a
 * recipe, so this is the only writer of it — `pos.catalog.sync` never touches it. Every ingredient must belong to the product's own store.
 */
export async function updateProductRecipe(input: {
  id: string;
  recipe: Array<{ rawIngredientId: string; quantity: number }>;
}): Promise<ProductListItem> {
  await connectDB();
  const product = await PartnerProductDB.findById(toObjectId(input.id))
    .select('storeId codPdv')
    .lean<LeanDoc | null>();
  if (!product) throw new NotFoundError('Product not found.');

  const ids = input.recipe.map((line) => line.rawIngredientId);
  if (new Set(ids).size !== ids.length) {
    throw new UnprocessableEntityError('An ingredient can appear only once in a recipe.');
  }
  if (ids.length > 0) {
    const found = await RawIngredientDB.countDocuments({
      _id: { $in: toObjectIds(ids) },
      storeId: toObjectId(String(product.storeId)),
    });
    if (found !== ids.length) {
      throw new UnprocessableEntityError('Every ingredient must belong to this store.');
    }
  }

  // A product with a PDV code saves its recipe under that code, so every catalog copy of it
  // (the iFood ones, a re-created row) shares it; without a code it stays on its own row.
  const codPdv = product.codPdv ? String(product.codPdv) : undefined;
  if (codPdv) {
    await saveSharedRecipe({
      storeId: String(product.storeId),
      kind: 'product',
      codPdv,
      recipe: input.recipe,
    });
  }
  const doc = await PartnerProductDB.findByIdAndUpdate(
    toObjectId(input.id),
    codPdv
      ? {}
      : {
          $set: {
            recipe: input.recipe.map((line) => ({
              rawIngredientId: toObjectId(line.rawIngredientId),
              quantity: line.quantity,
            })),
          },
        },
    { returnDocument: 'after' },
  )
    .select(LIST_FIELDS)
    .lean<ProductDoc | null>();
  if (!doc) throw new NotFoundError('Product not found.');

  const [item] = await hydrate([doc]);
  return item as ProductListItem;
}
