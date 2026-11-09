import {
  normalizeAliases,
  normalizeBarcodes,
  normalizePurchasePack,
} from '@/app/lib/ingredient-identity';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { BadRequestError, ConflictError, NotFoundError } from '@/app/lib/errors';
import { logger } from '@/app/lib/logger';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { roundCost, roundQuantity } from '@/app/lib/quantity-format';
import type { CostBasis } from '@/app/lib/services/raw-ingredients';
import PartnerProductDB from '@/app/models/partner-products';
import ProductRecipeDB from '@/app/models/product-recipes';
import RawIngredientDB from '@/app/models/raw-ingredients';
import StockMovementDB from '@/app/models/stock-movements';
import SupplierItemMappingDB from '@/app/models/supplier-item-mappings';

type Line = { rawIngredientId: unknown; quantity: number };

/**
 * One recipe's lines with the merged ingredients pointed at the target. Two lines that end up on
 * the same ingredient become one (their quantities add up): a recipe never lists an ingredient twice.
 */
function remapLines(lines: Line[], from: Set<string>, target: string): Line[] {
  const byId = new Map<string, Line>();
  for (const line of lines) {
    const id = from.has(String(line.rawIngredientId)) ? target : String(line.rawIngredientId);
    const existing = byId.get(id);
    if (existing) existing.quantity = roundQuantity(existing.quantity + Number(line.quantity));
    else byId.set(id, { rawIngredientId: toObjectId(id), quantity: Number(line.quantity) });
  }
  return [...byId.values()];
}

const usesAny = (lines: Line[] | undefined, from: Set<string>) =>
  (lines ?? []).some((line) => from.has(String(line.rawIngredientId)));

type Ids = ReturnType<typeof toObjectId>;

/** A sale is unique per (order, ingredient, revision): an order that used two of these would clash. */
async function assertNoOrderClash(storeId: Ids, allIds: string[]): Promise<void> {
  const clashes = await StockMovementDB.aggregate([
    {
      $match: {
        storeId,
        rawIngredientId: { $in: toObjectIds(allIds) },
        type: { $in: ['sale', 'reversal'] },
        'source.externalOrderId': { $exists: true },
      },
    },
    {
      $group: {
        _id: { type: '$type', order: '$source.externalOrderId', revision: '$source.orderRevision' },
        rows: { $sum: 1 },
      },
    },
    { $match: { rows: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  if (clashes.length > 0) {
    throw new ConflictError(
      'An order used more than one of these ingredients, so they cannot be merged without losing its history.',
    );
  }
}

/** De/Para and ledger point at the target now. Harmless to repeat. */
async function repointMappingsAndLedger(storeId: Ids, sourceIds: string[], targetId: string) {
  const filter = { storeId, rawIngredientId: { $in: toObjectIds(sourceIds) } };
  const set = { $set: { rawIngredientId: toObjectId(targetId) } };
  await SupplierItemMappingDB.updateMany(filter, set);
  await StockMovementDB.updateMany(filter, set);
}

/** Recipes saved by PDV code, and the ones inside catalog rows (products and complements). */
async function repointRecipes(storeId: Ids, sourceIds: string[], targetId: string) {
  const from = new Set(sourceIds);
  const inSources = { $in: toObjectIds(sourceIds) };

  const shared = await ProductRecipeDB.find({
    storeId,
    'recipe.rawIngredientId': inSources,
  }).lean<Array<LeanDoc & { recipe: Line[] }>>();
  for (const doc of shared) {
    await ProductRecipeDB.updateOne(
      { _id: doc._id },
      { $set: { recipe: remapLines(doc.recipe, from, targetId) } },
    );
  }

  // The recipes of the kitchen's own preparations (Molho Verde uses cebola) point at ingredients too.
  const preparations = await RawIngredientDB.find({
    storeId,
    'preparation.lines.rawIngredientId': inSources,
  })
    .select('preparation')
    .lean<Array<LeanDoc & { preparation: { lines: Line[] } }>>();
  for (const doc of preparations) {
    await RawIngredientDB.updateOne(
      { _id: doc._id },
      { $set: { 'preparation.lines': remapLines(doc.preparation.lines, from, targetId) } },
    );
  }

  const rows = await PartnerProductDB.find({
    storeId,
    $or: [
      { 'recipe.rawIngredientId': inSources },
      { 'modifiers.recipe.rawIngredientId': inSources },
    ],
  }).lean<Array<LeanDoc & { recipe?: Line[]; modifiers?: Array<{ recipe?: Line[] }> }>>();
  for (const row of rows) {
    const modifiers = (row.modifiers ?? []).map((modifier) => ({
      ...modifier,
      recipe: usesAny(modifier.recipe, from)
        ? remapLines(modifier.recipe as Line[], from, targetId)
        : modifier.recipe,
    }));
    const recipe = usesAny(row.recipe, from)
      ? remapLines(row.recipe as Line[], from, targetId)
      : row.recipe;
    await PartnerProductDB.updateOne({ _id: row._id }, { $set: { recipe, modifiers } });
  }
}

type LastPurchase = { at: Date; unitCost?: number };

/**
 * What the target holds after the merge, from the balances read before it: the summed stock, the
 * newest purchase of any of them, and the cost — the average weighted by the stock on hand, or the
 * unit cost of that newest purchase for `last_purchase`.
 */
export function mergedTotals(docs: LeanDoc[], target: LeanDoc, costBasis: CostBasis) {
  const held = (doc: LeanDoc) => Math.max(0, Number(doc.currentStock ?? 0));
  const heldTotal = docs.reduce((sum, doc) => sum + held(doc), 0);
  const newest = docs
    .map((doc) => doc.lastPurchase as LastPurchase | undefined)
    .filter((last): last is LastPurchase => Boolean(last?.at))
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const weighted =
    heldTotal > 0
      ? docs.reduce((sum, doc) => sum + held(doc) * Number(doc.averageCost ?? 0), 0) / heldTotal
      : undefined;
  const averageCost =
    costBasis === 'last_purchase' && newest?.unitCost !== undefined
      ? newest.unitCost
      : (weighted ?? newest?.unitCost ?? Number(target.averageCost ?? 0));
  return {
    newest,
    averageCost: roundCost(averageCost),
    currentStock: roundQuantity(docs.reduce((sum, doc) => sum + Number(doc.currentStock ?? 0), 0)),
    minAlertStock: Math.max(...docs.map((doc) => Number(doc.minAlertStock ?? 0))),
  };
}

/**
 * What the target is called after the merge: its own nicknames, then the names and nicknames of the
 * ones folded into it ("Bacon Perdigão" becomes a way to say "Bacon"), and their barcodes. The pack
 * it is bought in is the target's, or the first one of the others that has one.
 */
function mergedIdentity(docs: LeanDoc[], target: LeanDoc) {
  const others = docs.filter((doc) => doc !== target);
  const list = (doc: LeanDoc, field: 'aliases' | 'barcodes') =>
    ((doc[field] as string[] | undefined) ?? []).map(String);
  const pack = [target, ...others]
    .map((doc) => normalizePurchasePack(doc.purchasePack as { label?: string; quantity: number }))
    .find(Boolean);
  return {
    aliases: normalizeAliases(
      [
        ...list(target, 'aliases'),
        ...others.flatMap((doc) => [String(doc.name), ...list(doc, 'aliases')]),
      ],
      String(target.name),
    ),
    barcodes: normalizeBarcodes(docs.flatMap((doc) => list(doc, 'barcodes'))),
    pack,
  };
}

/**
 * Folds ingredients into one: "Bacon Sadia" and "Bacon Perdigão" become "Bacon". The target keeps
 * its name and receives what the others had:
 *
 *  - the De/Para (a supplier's SKU now credits the target; same unit, so the factor is unchanged),
 *  - the whole ledger (the history still adds up to the balance, which is the sum of the balances),
 *  - every recipe line, in products and in complements,
 *  - the stock; the cost is the average weighted by the stock on hand, or — for `last_purchase` —
 *    the unit cost of the newest purchase of any of them.
 *
 * The merged ingredients are then deleted. Not atomic (the store's MongoDB is not guaranteed to be
 * a replica set), so the steps go from the ones a re-run repeats harmlessly to the one that moves
 * the stock; the merge is logged with the balances it summed so a half-done run can be repaired.
 */
export async function mergeRawIngredients(input: {
  storeId: string;
  targetId: string;
  sourceIds: string[];
  costBasis?: CostBasis;
}): Promise<{ target: LeanDoc; merged: number }> {
  await connectDB();
  const sourceIds = [...new Set(input.sourceIds)].filter((id) => id !== input.targetId);
  if (sourceIds.length === 0) throw new BadRequestError('Pick at least one ingredient to merge.');

  const storeId = toObjectId(input.storeId);
  const allIds = [input.targetId, ...sourceIds];
  const docs = await RawIngredientDB.find({ _id: { $in: toObjectIds(allIds) }, storeId }).lean<
    LeanDoc[]
  >();
  if (docs.length !== allIds.length) throw new NotFoundError('Ingredient not found.');
  const target = docs.find((doc) => String(doc._id) === input.targetId) as LeanDoc;
  if (docs.some((doc) => doc.unit !== target.unit)) {
    throw new BadRequestError(
      'Only ingredients in the same unit can be merged (g with g, ml with ml, un with un).',
    );
  }
  await assertNoOrderClash(storeId, allIds);

  await repointMappingsAndLedger(storeId, sourceIds, input.targetId);
  await repointRecipes(storeId, sourceIds, input.targetId);

  const costBasis = input.costBasis ?? (target.costBasis as CostBasis | undefined) ?? 'average';
  const totals = mergedTotals(docs, target, costBasis);
  const identity = mergedIdentity(docs, target);
  logger.info(
    {
      storeId: input.storeId,
      targetId: input.targetId,
      balances: docs.map((doc) => ({
        id: String(doc._id),
        name: doc.name,
        currentStock: doc.currentStock,
        averageCost: doc.averageCost,
      })),
      after: { currentStock: totals.currentStock, averageCost: totals.averageCost },
    },
    'Merging ingredients',
  );

  const merged = await RawIngredientDB.findOneAndUpdate(
    { _id: toObjectId(input.targetId), storeId },
    {
      $set: {
        currentStock: totals.currentStock,
        averageCost: totals.averageCost,
        minAlertStock: totals.minAlertStock,
        costBasis,
        isDraft: false,
        aliases: identity.aliases,
        barcodes: identity.barcodes,
        ...(identity.pack && { purchasePack: identity.pack }),
        ...(totals.newest && { lastPurchase: totals.newest }),
      },
    },
    { returnDocument: 'after' },
  ).lean<LeanDoc | null>();
  if (!merged) throw new NotFoundError('Ingredient not found.');

  // Variations of a merged ingredient now hang under the target (or under the target's own main).
  // If the target was a variation of a merged one, it becomes a main itself.
  const targetOwnMain =
    target.familyOf && !sourceIds.includes(String(target.familyOf)) ? target.familyOf : undefined;
  await RawIngredientDB.updateMany(
    { storeId, _id: { $ne: target._id }, familyOf: { $in: toObjectIds(sourceIds) } },
    { $set: { familyOf: targetOwnMain ?? target._id } },
  );
  if (target.familyOf && !targetOwnMain) {
    await RawIngredientDB.updateOne({ _id: target._id }, { $unset: { familyOf: '' } });
  }
  // The merged ingredients are gone: nothing points at them any more.
  await RawIngredientDB.deleteMany({ _id: { $in: toObjectIds(sourceIds) }, storeId });
  return { target: merged, merged: sourceIds.length };
}
