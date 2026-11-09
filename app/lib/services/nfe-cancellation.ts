import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import { debitRawIngredientPurchase } from '@/app/lib/services/raw-ingredients';
import {
  deleteMovement,
  getLatestLivePurchase,
  recordReversalMovement,
  type PurchaseMovementInput,
} from '@/app/lib/services/stock-movements';
import InvoiceCancellationDB from '@/app/models/invoice-cancellations';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import StockMovementDB from '@/app/models/stock-movements';

// Worker-safe (no `./errors`): applied from the Bull worker when SEFAZ delivers
// a cancellation event.

export type CancellationOutcome =
  /** The invoice had been captured: its stock was given back. */
  | { status: 'reversed'; lines: number; reversedValue: number }
  /** Captured earlier but credited nothing (ignored): only marked cancelled. */
  | { status: 'marked' }
  /** Not captured yet: remembered, so capturing it later records it as cancelled. */
  | { status: 'recorded' }
  | { status: 'already' };

/** Gives back one purchase line. Mirrors `applyPurchase`: the reversal is written
 * first (its unique index is what makes a re-run skip finished lines), the stock
 * is debited second, and a failed debit removes the reversal so a retry applies it. */
export async function reverseLine(
  movement: LeanDoc,
  cancelledAt: Date,
  note?: string,
): Promise<number | null> {
  const purchase: PurchaseMovementInput = {
    storeId: String(movement.storeId),
    rawIngredientId: String(movement.rawIngredientId),
    occurredAt: movement.occurredAt as Date,
    quantity: Number(movement.quantity),
    unitCost: Number(movement.unitCost ?? 0),
    value: Number(movement.value ?? 0),
    source: movement.source as PurchaseMovementInput['source'],
  };

  const reversal = await recordReversalMovement(purchase, cancelledAt, note);
  if (reversal === 'duplicate') return null; // an earlier run already gave this line back

  try {
    // The reversal row exists now, so "latest surviving purchase" already excludes this line.
    const surviving = await getLatestLivePurchase(purchase.rawIngredientId);
    await debitRawIngredientPurchase(purchase.rawIngredientId, {
      convertedQuantity: purchase.quantity,
      lineValue: purchase.value,
      fallbackUnitCost: surviving?.unitCost,
      lastPurchase: surviving
        ? {
            at: surviving.occurredAt,
            supplierCnpj: surviving.supplierCnpj,
            supplierName: surviving.supplierName,
            invoiceNumber: surviving.invoiceNumber,
            quantity: surviving.quantity,
            unitCost: surviving.unitCost,
          }
        : null,
    });
  } catch (err) {
    await deleteMovement(reversal.id);
    throw err;
  }
  return purchase.value;
}

/**
 * SEFAZ reported this NFe cancelled. Idempotent per invoice line: delivering the
 * same event twice, or re-running one that died halfway, gives stock back once.
 * Scoped by store — an event can only touch an invoice this store captured.
 */
export async function applyInvoiceCancellation(
  storeId: string,
  accessKey: string,
  event: { cancelledAt: Date; nsu?: string },
): Promise<CancellationOutcome> {
  await connectDB();
  const store = toObjectId(storeId);

  const invoice = await ProcessedInvoiceDB.findOne({ storeId: store, accessKey })
    .select('status')
    .lean<{ status: string } | null>();

  if (!invoice) {
    await InvoiceCancellationDB.updateOne(
      { storeId: store, accessKey },
      { $setOnInsert: { cancelledAt: event.cancelledAt, nsu: event.nsu } },
      { upsert: true },
    );
    return { status: 'recorded' };
  }
  if (invoice.status === 'cancelled') return { status: 'already' };

  const movements = await StockMovementDB.find({
    storeId: store,
    type: 'purchase',
    'source.invoiceAccessKey': accessKey,
  })
    .sort({ 'source.itemIndex': 1 })
    .lean<LeanDoc[]>();

  let reversedValue = 0;
  let lines = 0;
  for (const movement of movements) {
    const value = await reverseLine(movement, event.cancelledAt);
    if (value === null) continue;
    reversedValue += value;
    lines += 1;
  }

  await ProcessedInvoiceDB.updateOne(
    { storeId: store, accessKey },
    { $set: { status: 'cancelled', cancelledAt: event.cancelledAt } },
  );

  return movements.length === 0
    ? { status: 'marked' }
    : { status: 'reversed', lines, reversedValue };
}

/** The cancellation SEFAZ already reported for an invoice not captured yet, if any. */
export async function findRecordedCancellation(
  storeId: string,
  accessKey: string,
): Promise<{ cancelledAt: Date } | null> {
  await connectDB();
  return InvoiceCancellationDB.findOne({ storeId: toObjectId(storeId), accessKey })
    .select('cancelledAt')
    .lean<{ cancelledAt: Date } | null>();
}
