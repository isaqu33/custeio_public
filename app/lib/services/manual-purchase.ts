import connectDB from '@/app/lib/connect-db';
import { UnprocessableEntityError } from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { roundCost } from '@/app/lib/quantity-format';
import { creditRawIngredientPurchase } from '@/app/lib/services/raw-ingredients';
import { deleteMovement, recordManualPurchaseMovement } from '@/app/lib/services/stock-movements';
import RawIngredientDB from '@/app/models/raw-ingredients';

export type ManualPurchaseInput = {
  storeId: string;
  /** Identifies this entry: a double submit with the same id credits the stock once. */
  requestId: string;
  userId?: string;
  supplierName: string;
  occurredAt: Date;
  note?: string;
  /** Quantity in the ingredient's own unit (g, ml, un) and the cost of one such unit. */
  lines: Array<{ rawIngredientId: string; quantity: number; unitCost: number }>;
};

export type ManualPurchaseResult = { applied: number; skipped: number; total: number };

/**
 * "Registrar compra": a purchase the owner types in because its note cannot be captured (an NFC-e
 * of a supplier that still issues one, a receipt, a purchase with no note at all). Each line credits
 * the ingredient exactly like an invoice line does — balance, weighted-average cost, "last purchase"
 * — and is kept in the ledger as a `purchase` with no invoice. Nothing here guesses: the owner gives
 * the quantity and the cost of each ingredient, because that is the only place that split exists
 * (the supplier's receipt often has a single "CARNE R$ 1.000" line).
 */
export async function registerManualPurchase(
  input: ManualPurchaseInput,
): Promise<ManualPurchaseResult> {
  await connectDB();

  const ids = input.lines.map((line) => line.rawIngredientId);
  if (new Set(ids).size !== ids.length) {
    throw new UnprocessableEntityError('An ingredient can appear only once in a purchase.');
  }
  const found = await RawIngredientDB.countDocuments({
    _id: { $in: toObjectIds(ids) },
    storeId: toObjectId(input.storeId),
  });
  if (found !== ids.length) {
    throw new UnprocessableEntityError('Every ingredient must belong to this store.');
  }

  let applied = 0;
  let skipped = 0;
  let total = 0;
  for (const [index, line] of input.lines.entries()) {
    const value = roundCost(line.quantity * line.unitCost);
    // The movement goes first: a retry then finds the lines already done and skips them.
    const movement = await recordManualPurchaseMovement({
      storeId: input.storeId,
      rawIngredientId: line.rawIngredientId,
      occurredAt: input.occurredAt,
      quantity: line.quantity,
      unitCost: line.unitCost,
      value,
      userId: input.userId,
      note: input.note,
      source: {
        supplierName: input.supplierName,
        manualBatchId: input.requestId,
        itemIndex: index,
      },
    });
    if (movement === 'duplicate') {
      skipped++;
      continue;
    }
    try {
      await creditRawIngredientPurchase(line.rawIngredientId, {
        convertedQuantity: line.quantity,
        lineValue: value,
        purchase: {
          at: input.occurredAt,
          supplierCnpj: '',
          supplierName: input.supplierName,
        },
      });
    } catch (err) {
      // The credit did not happen: take the movement back so a retry can apply the line.
      await deleteMovement(movement.id);
      throw err;
    }
    applied++;
    total += value;
  }
  return { applied, skipped, total: roundCost(total) };
}
