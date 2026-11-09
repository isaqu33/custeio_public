import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { ConflictError, NotFoundError } from '@/app/lib/errors';
import type { DensitySource } from '@/app/lib/density';
import {
  type IngredientKind,
  OPERATIONAL_KINDS,
  type OperationState,
  operationState,
} from '@/app/lib/ingredient-naming';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import { roundCost, roundQuantity } from '@/app/lib/quantity-format';
import { containsCondition } from '@/app/lib/search-regex';
import {
  getIngredientIdsInRecipes,
  getIngredientUsageCounts,
} from '@/app/lib/services/ingredient-usage';
import { getPendingDeliveries, type PendingDelivery } from '@/app/lib/services/pending-deliveries';
import {
  getRawIngredientIdsForSupplier,
  recordAdjustmentMovement,
} from '@/app/lib/services/stock-movements';
import {
  normalizeAliases,
  normalizeBarcodes,
  normalizePurchasePack,
  type PurchasePack,
} from '@/app/lib/ingredient-identity';
import RawIngredientDB from '@/app/models/raw-ingredients';

export type RawIngredientUnit = 'g' | 'ml' | 'un';
export type CostBasis = 'average' | 'last_purchase';

export type RawIngredientListItem = {
  _id: string;
  storeId: string;
  name: string;
  unit: RawIngredientUnit;
  currentStock: number;
  averageCost: number;
  minAlertStock: number;
  isDraft: boolean;
  kind: IngredientKind;
  /** The explicit decision on being part of the operation; absent means the kind decides. */
  inOperation?: boolean;
  /** Made in the kitchen (see the model): true when marked, or when it has a recipe. */
  isPreparation: boolean;
  /** Grams per ml, when known (see the model). */
  density?: { gramsPerMl: number; source: DensitySource };
  /** The main ingredient this is a variation of, when grouped (see the model). */
  familyOf?: string;
  /** Name of that main ingredient; only filled where the list loads it. */
  familyName?: string;
  /** How many variations hang under this one; only filled where the list loads it. */
  variantCount?: number;
  /** Its own stock plus its variations', when they are all in its unit (otherwise not summable). */
  familyStock?: number;
  /** Where it stands on being part of the operation (see `operationState`). */
  operation: OperationState;
  /** What the AI proposed, when it analyzed this one. */
  aiReview?: AiReview;
  /** `last_purchase`: the cost follows the newest purchase instead of the weighted average. */
  costBasis: CostBasis;
  /** What the kitchen makes itself: one batch's recipe and yield (see preparations.ts). */
  preparation?: { yield: number; lines: Array<{ rawIngredientId: string; quantity: number }> };
  /** How the team calls it besides `name` ("carne", "blend"). */
  aliases: string[];
  /** EAN/GTIN printed on the product and on the receipt line. */
  barcodes: string[];
  /** The pack it is bought in, in this ingredient's own unit. */
  purchasePack?: PurchasePack;
  /** The most recent purchase applied: when it was issued, by whom, and at what landed cost. */
  lastPurchase?: {
    at: string;
    supplierName?: string;
    supplierCnpj?: string;
    invoiceNumber?: string;
    quantity?: number;
    unitCost?: number;
  };
  /**
   * Set on a negative balance when a recent invoice of a supplier that sold this ingredient is
   * still only a preview: the delivery may be sold but not credited yet (pending-deliveries.ts).
   */
  pendingDelivery?: PendingDelivery;
  /** How many active products use it in a recipe. Filled on the listing, not on a single-row read. */
  usedInProducts?: number;
  createdAt: string;
};

const LIST_FIELDS =
  'storeId name unit currentStock averageCost minAlertStock isDraft kind inOperation isPreparation familyOf density aiReview costBasis preparation lastPurchase aliases barcodes purchasePack createdAt';

type LastPurchaseDoc = {
  at?: Date;
  supplierName?: string;
  supplierCnpj?: string;
  invoiceNumber?: string;
  quantity?: number;
  unitCost?: number;
};

function toLastPurchase(value: unknown): RawIngredientListItem['lastPurchase'] {
  const last = value as LastPurchaseDoc | undefined;
  if (!last?.at) return undefined;
  return {
    at: toIso(last.at),
    supplierName: last.supplierName || undefined,
    supplierCnpj: last.supplierCnpj || undefined,
    invoiceNumber: last.invoiceNumber || undefined,
    quantity: typeof last.quantity === 'number' ? last.quantity : undefined,
    unitCost: typeof last.unitCost === 'number' ? last.unitCost : undefined,
  };
}

function toPreparation(value: unknown): RawIngredientListItem['preparation'] {
  const prep = value as
    | { yield?: number; lines?: Array<{ rawIngredientId: unknown; quantity: number }> }
    | undefined;
  if (!prep?.yield || !prep.lines?.length) return undefined;
  return {
    yield: Number(prep.yield),
    lines: prep.lines.map((line) => ({
      rawIngredientId: String(line.rawIngredientId),
      quantity: Number(line.quantity),
    })),
  };
}

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export type AiReview = {
  analyzedAt: string;
  model: string;
  usedByRestaurant: boolean;
  kind: IngredientKind;
  cleanName?: string;
  aliases: string[];
  pack?: { quantity: number; unit: string };
  mergeInto?: string;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
  comparedWithMenu: boolean;
};

function toAiReview(raw: unknown): AiReview | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const pack = r.pack as { quantity?: number; unit?: string } | undefined;
  return {
    analyzedAt: toIso(r.analyzedAt),
    model: String(r.model ?? ''),
    usedByRestaurant: Boolean(r.usedByRestaurant),
    kind: (r.kind as IngredientKind | undefined) ?? 'other',
    cleanName: r.cleanName ? String(r.cleanName) : undefined,
    aliases: ((r.aliases as string[] | undefined) ?? []).map(String),
    pack: pack?.quantity && pack.unit ? { quantity: pack.quantity, unit: pack.unit } : undefined,
    mergeInto: r.mergeInto ? String(r.mergeInto) : undefined,
    confidence: (r.confidence as AiReview['confidence'] | undefined) ?? 'low',
    note: r.note ? String(r.note) : undefined,
    comparedWithMenu: Boolean(r.comparedWithMenu),
  };
}

function toDensity(value: unknown): RawIngredientListItem['density'] {
  const density = value as { gramsPerMl?: number; source?: DensitySource } | undefined;
  return density?.gramsPerMl && density.source
    ? { gramsPerMl: density.gramsPerMl, source: density.source }
    : undefined;
}

function toListItem(doc: LeanDoc): RawIngredientListItem {
  return {
    _id: String(doc._id),
    storeId: String(doc.storeId),
    name: String(doc.name ?? ''),
    unit: doc.unit as RawIngredientUnit,
    currentStock: Number(doc.currentStock ?? 0),
    averageCost: Number(doc.averageCost ?? 0),
    minAlertStock: Number(doc.minAlertStock ?? 0),
    isDraft: Boolean(doc.isDraft),
    kind: (doc.kind as IngredientKind | undefined) ?? 'food',
    inOperation: typeof doc.inOperation === 'boolean' ? doc.inOperation : undefined,
    isPreparation: doc.isPreparation === true || toPreparation(doc.preparation) !== undefined,
    familyOf: doc.familyOf ? String(doc.familyOf) : undefined,
    density: toDensity(doc.density),
    // Whether a recipe uses it is only known where the usage is loaded (the lists, below).
    operation: operationState(doc as Parameters<typeof operationState>[0], false),
    aiReview: toAiReview(doc.aiReview),
    costBasis: (doc.costBasis as CostBasis | undefined) ?? 'average',
    preparation: toPreparation(doc.preparation),
    aliases: ((doc.aliases as string[] | undefined) ?? []).map(String),
    barcodes: ((doc.barcodes as string[] | undefined) ?? []).map(String),
    purchasePack: normalizePurchasePack(doc.purchasePack as PurchasePack | undefined) ?? undefined,
    lastPurchase: toLastPurchase(doc.lastPurchase),
    createdAt: toIso(doc.createdAt),
  };
}

// MongoServerError E11000 — thrown by the (storeId, name) unique index when two
// ingredients of the same store would share a name.
function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

export async function getRawIngredientsForStore(storeId: string): Promise<RawIngredientListItem[]> {
  await connectDB();
  const ingredients = await RawIngredientDB.find({ storeId: toObjectId(storeId) })
    .select(LIST_FIELDS)
    .sort({ name: 1 })
    .lean();
  return ingredients.map((doc: LeanDoc) => toListItem(doc));
}

export type RawIngredientsPage = {
  data: RawIngredientListItem[];
  total: number;
  page: number;
  totalPages: number;
};

export type IngredientKindFilter = 'all' | IngredientKind;
export type IngredientUsageFilter = 'all' | 'used' | 'unused';
/** The three lists of Estoque: what is part of the operation, what is not, and what still needs the
 * owner (unreviewed drafts the AI was not sure about, or never analyzed). */
export type IngredientGroup = 'in' | 'out' | 'review';

/**
 * The Mongo filters of the three lists, the same rule as `operationState`: an explicit `inOperation`
 * wins; without one a non-operational kind is out; an operational draft that no recipe uses is
 * unconfirmed; everything else is in.
 */
function operationFilters(usedIds: unknown[]) {
  const undecided = { inOperation: { $exists: false } };
  const operationalKind = { kind: { $in: [...OPERATIONAL_KINDS] } };
  const unreviewedAndUnused = { isDraft: true, _id: { $nin: usedIds } };
  return {
    in: {
      $or: [
        { inOperation: true },
        {
          ...undecided,
          ...operationalKind,
          $or: [{ isDraft: { $ne: true } }, { _id: { $in: usedIds } }],
        },
      ],
    },
    out: {
      $or: [{ inOperation: false }, { ...undecided, kind: { $nin: [...OPERATIONAL_KINDS] } }],
    },
    review: { ...undecided, ...operationalKind, ...unreviewedAndUnused },
  };
}

// A preparation: it has a recipe, or someone marked it while the recipe is still to be written.
const IS_PREPARATION = {
  $or: [{ 'preparation.lines.0': { $exists: true } }, { isPreparation: true }],
};
const NOT_PREPARATION = {
  $and: [{ 'preparation.lines.0': { $exists: false } }, { isPreparation: { $ne: true } }],
};

function preparationCondition(mode: 'only' | 'exclude'): Record<string, unknown> {
  return mode === 'only' ? IS_PREPARATION : NOT_PREPARATION;
}

function groupCondition(group: IngredientGroup, usedIds: unknown[]): Record<string, unknown> {
  return operationFilters(usedIds)[group];
}

/** How many ingredients each list holds, whatever the search or filters. */
export async function getIngredientGroupCounts(
  storeId: string,
  options: { excludePreparations?: boolean; excludeVariants?: boolean } = {},
): Promise<Record<IngredientGroup, number>> {
  await connectDB();
  const store = toObjectId(storeId);
  const usedIds = toObjectIds([...(await getIngredientIdsInRecipes(storeId))]);
  const [inCount, outCount, reviewCount] = await Promise.all(
    (['in', 'out', 'review'] as const).map((group) =>
      RawIngredientDB.countDocuments({
        storeId: store,
        ...(options.excludePreparations && preparationCondition('exclude')),
        ...(options.excludeVariants && { familyOf: { $exists: false } }),
        ...groupCondition(group, usedIds),
      }),
    ),
  );
  return { in: inCount ?? 0, out: outCount ?? 0, review: reviewCount ?? 0 };
}
/** A supplier CNPJ, or 'all'. Not a fixed enum: it comes from what the store actually bought from. */
export type IngredientSupplierFilter = string;

type ListFilters = {
  q?: string;
  kind?: IngredientKindFilter;
  usage?: IngredientUsageFilter;
  supplier?: IngredientSupplierFilter;
  group?: IngredientGroup;
  /** What the kitchen makes (has a recipe) is its own page: `only` lists just those, `exclude` leaves them out. */
  preparations?: 'only' | 'exclude';
  /** `hide` leaves out the variations (they show under their main one); the default lists everything. */
  variants?: 'hide' | 'show';
  /** One family: the main ingredient with all its variations. */
  family?: string;
};

/** The conditions with an `$or` of their own (family, group, preparations): they nest under `$and`. */
function extraConditions(params: ListFilters, inRecipeIds: unknown[]): Record<string, unknown>[] {
  const family = params.family ? toObjectId(params.family) : undefined;
  return [
    ...(family ? [{ $or: [{ _id: family }, { familyOf: family }] }] : []),
    ...(params.group ? [groupCondition(params.group, inRecipeIds)] : []),
    ...(params.preparations ? [preparationCondition(params.preparations)] : []),
  ];
}

/** The Mongo filter for the table and its export, so both narrow the same way.
 * Conditions go through `$and` (not a flat object) so the usage and supplier
 * filters — both on `_id` — can combine instead of one overwriting the other. */
function buildQuery(
  storeId: string,
  params: ListFilters,
  usage: Map<string, number>,
  recipeIds: Set<string>,
  supplierIngredientIds?: string[],
) {
  const term = params.q?.trim();
  const usedIds = toObjectIds([...usage.keys()]);
  const inRecipeIds = toObjectIds([...recipeIds]);
  // Usage and supplier both narrow by `_id`: a flat object spread would let the
  // second one silently win over the first, so they only nest under `$and`
  // when both are actually active — every other combination stays a flat
  // object, same shape this query always had.
  const idConditions: Record<string, unknown>[] = [];
  if (params.usage === 'used') idConditions.push({ _id: { $in: usedIds } });
  if (params.usage === 'unused') idConditions.push({ _id: { $nin: usedIds } });
  if (supplierIngredientIds)
    idConditions.push({ _id: { $in: toObjectIds(supplierIngredientIds) } });

  const extras = extraConditions(params, inRecipeIds);

  return {
    storeId: toObjectId(storeId),
    // The name, a nickname or a barcode: however the team (or a receipt) calls it.
    ...(term && {
      $or: [
        { name: containsCondition(term) },
        { aliases: containsCondition(term) },
        { barcodes: containsCondition(term) },
      ],
    }),
    ...(params.kind && params.kind !== 'all' && { kind: params.kind }),
    ...(params.variants === 'hide' && { familyOf: { $exists: false } }),
    ...(idConditions.length === 1 && extras.length === 0 && idConditions[0]),
    // The group has its own `$or`, which would clash with the search's: it nests under `$and`.
    ...((idConditions.length > 1 || extras.length > 0) && { $and: [...idConditions, ...extras] }),
  };
}

/** Resolves the "Fornecedor" filter to the ingredient ids it narrows to — only
 * queried when a supplier is actually selected, since every other filter is free. */
async function supplierIdsFor(storeId: string, supplier?: string): Promise<string[] | undefined> {
  if (!supplier || supplier === 'all') return undefined;
  return getRawIngredientIdsForSupplier(storeId, supplier);
}

/** One page of a store's ingredients for the Estoque table, narrowed by name,
 * kind and whether any recipe uses it — same shape the other listing screens paginate with. */
export async function getRawIngredientsPageForStore(
  storeId: string,
  params: ListFilters & { page?: number; limit?: number } = {},
): Promise<RawIngredientsPage> {
  await connectDB();
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 20;
  const [usage, recipeIds, supplierIds] = await Promise.all([
    getIngredientUsageCounts(storeId),
    getIngredientIdsInRecipes(storeId),
    supplierIdsFor(storeId, params.supplier),
  ]);
  const query = buildQuery(storeId, params, usage, recipeIds, supplierIds);

  const [ingredients, total] = await Promise.all([
    RawIngredientDB.find(query)
      .select(LIST_FIELDS)
      // Newest first; `_id` breaks the tie for rows inserted in the same instant (an invoice batch).
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RawIngredientDB.countDocuments(query),
  ]);

  const pending = await getPendingDeliveries(
    storeId,
    ingredients
      .filter((doc: LeanDoc) => Number(doc.currentStock) < 0)
      .map((doc) => String(doc._id)),
  );

  const families = await loadFamilies(storeId, ingredients);

  return {
    data: ingredients.map((doc: LeanDoc) => ({
      ...toListItem(doc),
      familyName: doc.familyOf ? families.names.get(String(doc.familyOf)) : undefined,
      variantCount: families.counts.get(String(doc._id)) ?? 0,
      familyStock: familyStockOf(doc, families.variants.get(String(doc._id))),
      operation: operationState(
        doc as Parameters<typeof operationState>[0],
        recipeIds.has(String(doc._id)),
      ),
      usedInProducts: usage.get(String(doc._id)) ?? 0,
      pendingDelivery: pending.get(String(doc._id)),
    })),
    total,
    page,
    totalPages: totalPages(total, limit),
  };
}

/** For the rows of one page: how many variations each has, and the names of the mains they point to. */
async function loadFamilies(storeId: string, rows: LeanDoc[]) {
  const store = toObjectId(storeId);
  const ids = rows.map((doc) => doc._id);
  const mainIds = rows.filter((doc) => doc.familyOf).map((doc) => doc.familyOf);
  const [counts, mains] = await Promise.all([
    RawIngredientDB.aggregate<{ _id: unknown; n: number; stock: number; units: string[] }>([
      { $match: { storeId: store, familyOf: { $in: ids } } },
      {
        $group: {
          _id: '$familyOf',
          n: { $sum: 1 },
          stock: { $sum: '$currentStock' },
          units: { $addToSet: '$unit' },
        },
      },
    ]),
    mainIds.length > 0
      ? RawIngredientDB.find({ _id: { $in: mainIds } })
          .select('name')
          .lean<LeanDoc[]>()
      : [],
  ]);
  return {
    counts: new Map(counts.map((row) => [String(row._id), row.n])),
    variants: new Map(counts.map((row) => [String(row._id), row])),
    names: new Map(mains.map((doc) => [String(doc._id), String(doc.name)])),
  };
}

/** The main's stock plus its variations', only when every variation is in the main's own unit. */
function familyStockOf(
  main: LeanDoc,
  variants: { stock: number; units: string[] } | undefined,
): number | undefined {
  if (!variants || variants.units.some((unit) => unit !== main.unit)) return undefined;
  return roundQuantity(Number(main.currentStock ?? 0) + variants.stock);
}

/** The variations of one main ingredient, for the "Variações" view. */
export async function getVariantsOf(mainId: string): Promise<RawIngredientListItem[]> {
  await connectDB();
  const docs = await RawIngredientDB.find({ familyOf: toObjectId(mainId) })
    .select(LIST_FIELDS)
    .sort({ name: 1 })
    .lean();
  return docs.map((doc: LeanDoc) => toListItem(doc));
}

/**
 * Validates grouping `id` under `mainId`: same store, not itself, the main is not a variation, and
 * `id` has no variations of its own (families are one level deep).
 */
async function assertFamily(id: string, mainId: string): Promise<void> {
  if (id === mainId) throw new ConflictError('An ingredient cannot be a variation of itself.');
  const [current, main, hasVariants] = await Promise.all([
    RawIngredientDB.findById(toObjectId(id)).select('storeId').lean<LeanDoc | null>(),
    RawIngredientDB.findById(toObjectId(mainId)).select('storeId familyOf').lean<LeanDoc | null>(),
    RawIngredientDB.exists({ familyOf: toObjectId(id) }),
  ]);
  if (!current || !main) throw new NotFoundError('Ingredient not found.');
  if (String(current.storeId) !== String(main.storeId)) {
    throw new ConflictError('The main ingredient belongs to another store.');
  }
  if (main.familyOf) throw new ConflictError('The main ingredient is already a variation.');
  if (hasVariants) throw new ConflictError('This ingredient already has variations of its own.');
}

const EXPORT_LIMIT = 5000;

/** Every ingredient matching the filters, for the CSV export (no pagination). */
export async function getAllRawIngredientsForStore(
  storeId: string,
  params: ListFilters = {},
): Promise<RawIngredientListItem[]> {
  await connectDB();
  const [usage, recipeIds, supplierIds] = await Promise.all([
    getIngredientUsageCounts(storeId),
    getIngredientIdsInRecipes(storeId),
    supplierIdsFor(storeId, params.supplier),
  ]);
  const ingredients = await RawIngredientDB.find(
    buildQuery(storeId, params, usage, recipeIds, supplierIds),
  )
    .select(LIST_FIELDS)
    .sort({ name: 1 })
    .limit(EXPORT_LIMIT)
    .lean();
  return ingredients.map((doc: LeanDoc) => ({
    ...toListItem(doc),
    operation: operationState(
      doc as Parameters<typeof operationState>[0],
      recipeIds.has(String(doc._id)),
    ),
    usedInProducts: usage.get(String(doc._id)) ?? 0,
  }));
}

/** Resolves the owning store of an ingredient — routes need this to run the
 * authorization check (store → organization) before the caller-supplied `id`
 * is trusted for anything. */
export async function getRawIngredientStoreId(id: string): Promise<string | null> {
  await connectDB();
  const doc = await RawIngredientDB.findById(toObjectId(id)).select('storeId').lean();
  return doc ? String((doc as LeanDoc).storeId) : null;
}

export async function createRawIngredientForStore(input: {
  storeId: string;
  name: string;
  unit: RawIngredientUnit;
  currentStock?: number;
  averageCost?: number;
  minAlertStock?: number;
  // Set by sefaz.nfe.received (Tier 1) when it auto-creates this record from an
  // unmapped NFe line — never set by the manual "Novo insumo" form.
  isDraft?: boolean;
  kind?: IngredientKind;
  isPreparation?: boolean;
  aliases?: string[];
  barcodes?: string[];
  purchasePack?: { label?: string; quantity: number } | null;
  userId?: string;
}): Promise<RawIngredientListItem> {
  await connectDB();
  const barcodes = normalizeBarcodes(input.barcodes ?? []);
  await assertBarcodesFree(input.storeId, undefined, barcodes);
  const purchasePack = normalizePurchasePack(input.purchasePack);
  try {
    const doc = await RawIngredientDB.create({
      storeId: toObjectId(input.storeId),
      name: input.name,
      unit: input.unit,
      currentStock: input.currentStock ?? 0,
      averageCost: input.averageCost ?? 0,
      minAlertStock: input.minAlertStock ?? 0,
      isDraft: input.isDraft ?? false,
      kind: input.kind ?? 'food',
      ...(input.isPreparation && { isPreparation: true }),
      aliases: normalizeAliases(input.aliases ?? [], input.name),
      barcodes,
      ...(purchasePack && { purchasePack }),
    });
    const created = toListItem(doc.toObject());
    // A balance typed into the "Novo insumo" form is the first entry of its ledger.
    if (created.currentStock !== 0) {
      await recordAdjustmentMovement({
        storeId: input.storeId,
        rawIngredientId: created._id,
        balanceBefore: 0,
        balanceAfter: created.currentStock,
        note: 'Saldo inicial',
        userId: input.userId,
      });
    }
    return created;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('An ingredient with this name already exists for this store.');
    }
    throw err;
  }
}

export type PurchaseCreditInput = {
  /** In the ingredient's own unit. */
  convertedQuantity: number;
  /** What the line really cost: freight, other expenses and discounts spread in. */
  lineValue: number;
  /** Which invoice it came from, kept on the ingredient as its "last purchase". */
  purchase?: {
    at: Date;
    supplierCnpj: string;
    supplierName: string;
    invoiceNumber?: string;
  };
};

/**
 * Credits a purchase onto an ingredient's stock/cost — Half 1 of
 * docs/features/stock-and-cmv.md, the sefaz.nfe.received side. A single
 * pipeline update (not read-then-write) so a second invoice line landing
 * concurrently can never read a stale `currentStock`/`averageCost`.
 */
export async function creditRawIngredientPurchase(
  id: string,
  input: PurchaseCreditInput,
): Promise<RawIngredientListItem> {
  await connectDB();
  // Weighted-average cost has to read the balance as it is in the database, so
  // it is an aggregation-pipeline update (an array). Mongoose 9 refuses that
  // shape unless `updatePipeline` is set.
  //
  // Only the stock actually on hand carries cost into the average: a negative
  // balance (sold before it was bought, or a discrepancy) is not inventory worth
  // averaging in, so it counts as 0 there. The balance itself still moves by the
  // full quantity. A resulting weight of 0 would divide by zero, so the cost is
  // then left as it was. Rounded to 8 decimals: without it the division leaves
  // float dust ("0,0024980000000000002") that ends up in forms and exports.
  const held = { $max: [0, '$currentStock'] };
  const weight = { $add: [held, input.convertedQuantity] };
  const purchase = input.purchase;
  const weightedCost = {
    $cond: [
      { $gt: [weight, 0] },
      {
        $round: [
          {
            $divide: [{ $add: [{ $multiply: [held, '$averageCost'] }, input.lineValue] }, weight],
          },
          8,
        ],
      },
      '$averageCost',
    ],
  };
  // `last_purchase`: a purchase newer than the last one applied sets the cost outright, and an
  // older invoice captured late (a backfill) leaves it alone — the average never enters.
  const costAfter =
    purchase && input.convertedQuantity > 0
      ? {
          $cond: [
            { $eq: ['$costBasis', 'last_purchase'] },
            {
              $cond: [
                { $gt: [purchase.at, { $ifNull: ['$lastPurchase.at', new Date(0)] }] },
                roundCost(input.lineValue / input.convertedQuantity),
                '$averageCost',
              ],
            },
            weightedCost,
          ],
        }
      : weightedCost;
  const doc = await RawIngredientDB.findOneAndUpdate(
    { _id: toObjectId(id) },
    [
      {
        $set: {
          averageCost: costAfter,
          currentStock: { $add: ['$currentStock', input.convertedQuantity] },
          // Only ever moves forward in time: an older invoice captured later
          // (a backfill) must not replace a newer "last purchase". User-controlled
          // text goes through $literal so a supplier named "$x" is not read as a field path.
          ...(purchase && {
            lastPurchase: {
              $cond: [
                { $gt: [purchase.at, { $ifNull: ['$lastPurchase.at', new Date(0)] }] },
                {
                  at: purchase.at,
                  supplierCnpj: { $literal: purchase.supplierCnpj },
                  supplierName: { $literal: purchase.supplierName },
                  invoiceNumber: { $literal: purchase.invoiceNumber ?? '' },
                  quantity: input.convertedQuantity,
                  unitCost:
                    input.convertedQuantity > 0
                      ? roundCost(input.lineValue / input.convertedQuantity)
                      : 0,
                },
                '$lastPurchase',
              ],
            },
          }),
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  )
    .select(LIST_FIELDS)
    .lean();

  if (!doc) throw new NotFoundError('Ingredient not found.');
  return toListItem(doc);
}

export type PurchaseDebitInput = {
  /** What the cancelled line had credited, in the ingredient's own unit. */
  convertedQuantity: number;
  /** The landed cost that line had added. */
  lineValue: number;
  /** Cost to fall back on when no stock is left to average (latest surviving purchase). */
  fallbackUnitCost?: number;
  /** The most recent purchase that survives the cancellation, or `null` when none does. */
  lastPurchase: {
    at: Date;
    supplierCnpj: string;
    supplierName: string;
    invoiceNumber?: string;
    quantity: number;
    unitCost: number;
  } | null;
};

/**
 * Takes a cancelled invoice line back out of an ingredient — the inverse of
 * `creditRawIngredientPurchase`. The balance moves by the full quantity (it may
 * go negative if the stock was already used). The average is a running weighted
 * one, so the line's value is removed from the pool of stock on hand:
 *
 *   (held × cost − lineValue) / (held − quantity)
 *
 * That is exact when the line is the latest operation and a close, defensible
 * answer after later purchases — the ledger cannot replay counts and manual cost
 * edits, so it is not recomputed from scratch. With nothing left on hand the
 * average has no weight to carry: it falls back to the latest surviving
 * purchase's cost, or stays as it was. One pipeline update, like the credit.
 */
export async function debitRawIngredientPurchase(
  id: string,
  input: PurchaseDebitInput,
): Promise<RawIngredientListItem> {
  await connectDB();
  const held = { $max: [0, '$currentStock'] };
  const remaining = { $subtract: [held, input.convertedQuantity] };
  const unchanged = input.fallbackUnitCost === undefined ? '$averageCost' : input.fallbackUnitCost;
  const last = input.lastPurchase;
  const doc = await RawIngredientDB.findOneAndUpdate(
    { _id: toObjectId(id) },
    [
      {
        $set: {
          // `last_purchase` follows the newest purchase that survives the cancellation.
          averageCost: {
            $cond: [
              { $and: [{ $eq: ['$costBasis', 'last_purchase'] }, { $literal: last !== null }] },
              last ? last.unitCost : '$averageCost',
              {
                $cond: [
                  { $gt: [remaining, 0] },
                  {
                    $round: [
                      {
                        $max: [
                          0,
                          {
                            $divide: [
                              {
                                $subtract: [{ $multiply: [held, '$averageCost'] }, input.lineValue],
                              },
                              remaining,
                            ],
                          },
                        ],
                      },
                      8,
                    ],
                  },
                  unchanged,
                ],
              },
            ],
          },
          currentStock: { $subtract: ['$currentStock', input.convertedQuantity] },
          // Re-pointed at the latest purchase that still counts. User-controlled
          // text goes through $literal so a supplier named "$x" is not a field path.
          lastPurchase: last
            ? {
                at: last.at,
                supplierCnpj: { $literal: last.supplierCnpj },
                supplierName: { $literal: last.supplierName },
                invoiceNumber: { $literal: last.invoiceNumber ?? '' },
                quantity: last.quantity,
                unitCost: last.unitCost,
              }
            : '$$REMOVE',
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  )
    .select(LIST_FIELDS)
    .lean();

  if (!doc) throw new NotFoundError('Ingredient not found.');
  return toListItem(doc);
}

type IngredientEdit = {
  id: string;
  name?: string;
  unit?: RawIngredientUnit;
  kind?: IngredientKind;
  inOperation?: boolean;
  isPreparation?: boolean;
  /** The main ingredient to group under; `null` takes it out of the family. */
  familyOf?: string | null;
  /** Grams per ml typed by the owner; `null` takes it away. */
  gramsPerMl?: number | null;
  costBasis?: CostBasis;
  currentStock?: number;
  averageCost?: number;
  minAlertStock?: number;
  aliases?: string[];
  barcodes?: string[];
  /** `null` takes the pack away. */
  purchasePack?: { label?: string; quantity: number } | null;
  userId?: string;
};

/**
 * The nicknames, barcodes and pack of an edit, cleaned, as what to `$set` and what to `$unset`. A
 * barcode already used by another ingredient of the store is refused: it is a key, not a label.
 */
async function identityChanges(
  id: string,
  input: Pick<IngredientEdit, 'name' | 'aliases' | 'barcodes' | 'purchasePack'>,
): Promise<{ set: Record<string, unknown>; unset: Record<string, ''> }> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (
    input.aliases === undefined &&
    input.barcodes === undefined &&
    input.purchasePack === undefined
  ) {
    return { set, unset };
  }
  const current = await RawIngredientDB.findById(toObjectId(id))
    .select('storeId name')
    .lean<LeanDoc | null>();
  if (!current) throw new NotFoundError('Ingredient not found.');

  if (input.aliases !== undefined) {
    set.aliases = normalizeAliases(input.aliases, input.name ?? String(current.name));
  }
  if (input.barcodes !== undefined) {
    const barcodes = normalizeBarcodes(input.barcodes);
    await assertBarcodesFree(String(current.storeId), id, barcodes);
    set.barcodes = barcodes;
  }
  if (input.purchasePack !== undefined) {
    const pack = normalizePurchasePack(input.purchasePack);
    if (pack) set.purchasePack = pack;
    else unset.purchasePack = '';
  }
  return { set, unset };
}

async function assertBarcodesFree(storeId: string, id: string | undefined, barcodes: string[]) {
  if (barcodes.length === 0) return;
  const taken = await RawIngredientDB.findOne({
    storeId: toObjectId(storeId),
    barcodes: { $in: barcodes },
    ...(id && { _id: { $ne: toObjectId(id) } }),
  })
    .select('name')
    .lean<LeanDoc | null>();
  if (taken) {
    throw new ConflictError(`This barcode is already used by "${String(taken.name)}".`);
  }
}

/** The fields a manual edit may change, normalized (no float dust) and only the ones sent. */
function editFields(input: IngredientEdit) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.unit !== undefined && { unit: input.unit }),
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.inOperation !== undefined && { inOperation: input.inOperation }),
    ...(input.isPreparation !== undefined && { isPreparation: input.isPreparation }),
    ...(input.costBasis !== undefined && { costBasis: input.costBasis }),
    ...(input.currentStock !== undefined && { currentStock: roundQuantity(input.currentStock) }),
    ...(input.averageCost !== undefined && { averageCost: roundCost(input.averageCost) }),
    ...(input.minAlertStock !== undefined && { minAlertStock: roundQuantity(input.minAlertStock) }),
  };
}

/** The family (validated) and the density an edit asks for, added to what is set or unset. */
async function applyFamilyAndDensity(
  input: IngredientEdit,
  changes: { set: Record<string, unknown>; unset: Record<string, ''> },
): Promise<void> {
  if (typeof input.familyOf === 'string') {
    await assertFamily(input.id, input.familyOf);
    changes.set.familyOf = toObjectId(input.familyOf);
  } else if (input.familyOf === null) {
    changes.unset.familyOf = '';
  }
  if (typeof input.gramsPerMl === 'number') {
    changes.set.density = { gramsPerMl: input.gramsPerMl, source: 'manual' };
  } else if (input.gramsPerMl === null) {
    changes.unset.density = '';
  }
}

export async function updateRawIngredient(input: IngredientEdit): Promise<RawIngredientListItem> {
  await connectDB();
  // Editing the balance by hand is a change of stock like any other: it goes in
  // the ledger too, so the history still adds up to the balance.
  const before =
    input.currentStock !== undefined
      ? await RawIngredientDB.findById(toObjectId(input.id))
          .select('storeId currentStock')
          .lean<LeanDoc | null>()
      : null;
  const identity = await identityChanges(input.id, input);
  await applyFamilyAndDensity(input, identity);
  try {
    const doc = await RawIngredientDB.findByIdAndUpdate(
      toObjectId(input.id),
      {
        // Editing and saving by hand is what "confirming a draft" means — a
        // record that was never a draft is unaffected by setting this false
        // again. The job never calls this function (see
        // creditRawIngredientPurchase), so it never clears the flag itself.
        $set: { ...editFields(input), ...identity.set, isDraft: false },
        ...(Object.keys(identity.unset).length > 0 && { $unset: identity.unset }),
      },
      { returnDocument: 'after' },
    )
      .select(LIST_FIELDS)
      .lean();

    if (!doc) throw new NotFoundError('Ingredient not found.');
    if (before) await recordEditedBalance(before, toListItem(doc), input);
    return toListItem(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('An ingredient with this name already exists for this store.');
    }
    throw err;
  }
}

async function recordEditedBalance(
  before: LeanDoc,
  after: RawIngredientListItem,
  input: IngredientEdit,
): Promise<void> {
  if (Number(before.currentStock) === after.currentStock) return;
  await recordAdjustmentMovement({
    storeId: String(before.storeId),
    rawIngredientId: input.id,
    balanceBefore: Number(before.currentStock),
    balanceAfter: after.currentStock,
    note: 'Edição manual',
    userId: input.userId,
  });
}

/**
 * An inventory count: the owner counted the shelf and this is the balance. Sets
 * `currentStock` to it and keeps the difference in the ledger, so purchases from
 * here on add to a number somebody actually looked at. The cost is untouched.
 */
export async function countRawIngredientStock(input: {
  id: string;
  countedStock: number;
  note?: string;
  userId?: string;
}): Promise<RawIngredientListItem> {
  await connectDB();
  const counted = roundQuantity(input.countedStock);
  const before = await RawIngredientDB.findByIdAndUpdate(
    toObjectId(input.id),
    { $set: { currentStock: counted } },
    { returnDocument: 'before' },
  )
    .select('storeId currentStock')
    .lean<LeanDoc | null>();
  if (!before) throw new NotFoundError('Ingredient not found.');

  await recordAdjustmentMovement({
    storeId: String(before.storeId),
    rawIngredientId: input.id,
    balanceBefore: Number(before.currentStock),
    balanceAfter: counted,
    note: input.note?.trim() || 'Contagem de estoque',
    userId: input.userId,
  });

  const doc = await RawIngredientDB.findById(toObjectId(input.id)).select(LIST_FIELDS).lean();
  if (!doc) throw new NotFoundError('Ingredient not found.');
  return toListItem(doc);
}

/**
 * "Fora / na operação" for many ingredients at once: the picked ids, or every ingredient of a list
 * (`filters`, the same narrowing as the table) — what the owner does with the "A confirmar" list when
 * none of it belongs. Only `inOperation` is written; nothing is deleted. Returns how many changed.
 */
export async function setInOperationForStore(input: {
  storeId: string;
  inOperation: boolean;
  ids?: string[];
  filters?: ListFilters;
}): Promise<number> {
  await connectDB();
  const store = toObjectId(input.storeId);
  if (input.ids) {
    const result = await RawIngredientDB.updateMany(
      { storeId: store, _id: { $in: toObjectIds(input.ids) } },
      { $set: { inOperation: input.inOperation } },
    );
    return result.modifiedCount;
  }
  const filters = { ...input.filters, preparations: 'exclude' as const };
  const [usage, recipeIds, supplierIds] = await Promise.all([
    getIngredientUsageCounts(input.storeId),
    getIngredientIdsInRecipes(input.storeId),
    supplierIdsFor(input.storeId, filters.supplier),
  ]);
  const result = await RawIngredientDB.updateMany(
    buildQuery(input.storeId, filters, usage, recipeIds, supplierIds),
    { $set: { inOperation: input.inOperation } },
  );
  return result.modifiedCount;
}
