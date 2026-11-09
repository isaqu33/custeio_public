import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { derivePreparationDensity } from '@/app/lib/density';
import { BadRequestError, NotFoundError } from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { roundCost, roundQuantity } from '@/app/lib/quantity-format';
import { creditRawIngredientPurchase } from '@/app/lib/services/raw-ingredients';
import { deleteMovement, recordProductionMovement } from '@/app/lib/services/stock-movements';
import RawIngredientDB from '@/app/models/raw-ingredients';

type PreparationLine = { rawIngredientId: string; quantity: number };

/**
 * Saves what one batch of a preparation takes and yields. Every ingredient must be in the same
 * store, none can be the preparation itself, and none can be listed twice. Empty lines (or a zero
 * yield) clear the preparation.
 */
export async function savePreparation(input: {
  id: string;
  yield: number;
  lines: PreparationLine[];
}): Promise<void> {
  await connectDB();
  const prep = await RawIngredientDB.findById(toObjectId(input.id))
    .select('storeId unit density')
    .lean<LeanDoc | null>();
  if (!prep) throw new NotFoundError('Ingredient not found.');

  if (input.lines.length === 0 || input.yield <= 0) {
    await RawIngredientDB.updateOne({ _id: prep._id }, { $unset: { preparation: '' } });
    return;
  }

  const ids = input.lines.map((line) => line.rawIngredientId);
  if (new Set(ids).size !== ids.length) throw new BadRequestError('An ingredient is listed twice.');
  if (ids.includes(input.id)) throw new BadRequestError('A preparation cannot use itself.');
  const lineIngredients = await RawIngredientDB.find({
    _id: { $in: toObjectIds(ids) },
    storeId: toObjectId(String(prep.storeId)),
  })
    .select('unit')
    .lean<LeanDoc[]>();
  if (lineIngredients.length !== ids.length) throw new NotFoundError('Ingredient not found.');
  const unitOf = new Map(lineIngredients.map((doc) => [String(doc._id), String(doc.unit)]));
  // What the recipe says about the density: the owner's own value is never overwritten.
  const derived = derivePreparationDensity(
    String(prep.unit),
    input.yield,
    input.lines.map((line) => ({
      quantity: line.quantity,
      unit: unitOf.get(line.rawIngredientId) ?? 'un',
    })),
  );
  const ownerSet = (prep.density as { source?: string } | undefined)?.source === 'manual';

  await RawIngredientDB.updateOne(
    { _id: prep._id },
    {
      $set: {
        ...(derived && !ownerSet && { density: { gramsPerMl: derived, source: 'derived' } }),
        preparation: {
          yield: roundQuantity(input.yield),
          lines: input.lines.map((line) => ({
            rawIngredientId: toObjectId(line.rawIngredientId),
            quantity: roundQuantity(line.quantity),
          })),
        },
      },
    },
  );
}

export type BatchResult = {
  /** True when this exact entry (same requestId) was already registered; nothing changed. */
  duplicate: boolean;
  produced: number;
  /** What the ingredients that went in cost, and so what the batch is worth. */
  totalCost: number;
};

/**
 * "Registrar lote": the kitchen made `producedQuantity` of a preparation. The recipe is scaled by
 * produced ÷ yield; each ingredient goes out of stock at its average cost and the preparation comes
 * in, its average cost rolled forward with what the batch cost. The preparation's own row is written
 * first and is what makes a repeat of the same `requestId` a no-op; each stock move is written after
 * its ledger row and taken back if it fails.
 */
export async function registerPreparationBatch(input: {
  id: string;
  producedQuantity: number;
  requestId: string;
  userId?: string;
}): Promise<BatchResult> {
  await connectDB();
  const prep = await RawIngredientDB.findById(toObjectId(input.id))
    .select('storeId preparation')
    .lean<LeanDoc | null>();
  if (!prep) throw new NotFoundError('Ingredient not found.');
  const recipe = prep.preparation as { yield: number; lines: PreparationLine[] } | undefined;
  if (!recipe?.lines?.length) throw new BadRequestError('This ingredient has no preparation.');

  const storeId = String(prep.storeId);
  const factor = input.producedQuantity / recipe.yield;
  const costs = new Map(
    (
      await RawIngredientDB.find({
        _id: { $in: toObjectIds(recipe.lines.map((line) => String(line.rawIngredientId))) },
        storeId: toObjectId(storeId),
      })
        .select('averageCost')
        .lean<LeanDoc[]>()
    ).map((doc) => [String(doc._id), Number(doc.averageCost ?? 0)]),
  );
  const used = recipe.lines.map((line) => {
    const id = String(line.rawIngredientId);
    return { id, quantity: roundQuantity(line.quantity * factor), unitCost: costs.get(id) ?? 0 };
  });
  const totalCost = roundCost(used.reduce((sum, row) => sum + row.quantity * row.unitCost, 0));

  const gate = await recordProductionMovement({
    storeId,
    rawIngredientId: input.id,
    batchId: input.requestId,
    quantity: input.producedQuantity,
    unitCost: roundCost(totalCost / input.producedQuantity),
    userId: input.userId,
  });
  if (gate === 'duplicate') {
    return { duplicate: true, produced: input.producedQuantity, totalCost };
  }

  for (const row of used) {
    const movement = await recordProductionMovement({
      storeId,
      rawIngredientId: row.id,
      batchId: input.requestId,
      quantity: -row.quantity,
      unitCost: row.unitCost,
      userId: input.userId,
    });
    if (movement === 'duplicate') continue;
    try {
      await RawIngredientDB.updateOne(
        { _id: toObjectId(row.id) },
        { $inc: { currentStock: -row.quantity } },
      );
    } catch (err) {
      await deleteMovement(movement.id);
      throw err;
    }
  }

  await creditRawIngredientPurchase(input.id, {
    convertedQuantity: input.producedQuantity,
    lineValue: totalCost,
  });
  return { duplicate: false, produced: input.producedQuantity, totalCost };
}
