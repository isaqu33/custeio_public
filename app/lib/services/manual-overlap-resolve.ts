import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { NotFoundError } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { reverseLine } from '@/app/lib/services/nfe-cancellation';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import StockMovementDB from '@/app/models/stock-movements';

/**
 * The owner's answer to "this invoice looks like a purchase you already typed in":
 *  - `undo`: the hand-typed purchase is given back (a reversal, like a cancelled invoice's line),
 *    because the invoice now carries it;
 *  - `keep`: they are two different deliveries; nothing changes in stock.
 * Scoped by store and by the invoice's own list: a movement that was not flagged on this invoice
 * cannot be undone through it.
 */
export async function resolveManualOverlap(input: {
  storeId: string;
  accessKey: string;
  movementId: string;
  action: 'undo' | 'keep';
}): Promise<void> {
  await connectDB();
  const store = toObjectId(input.storeId);
  const invoice = await ProcessedInvoiceDB.findOne({
    storeId: store,
    accessKey: input.accessKey,
    'manualOverlaps.movementId': toObjectId(input.movementId),
  })
    .select('number manualOverlaps')
    .lean<LeanDoc | null>();
  if (!invoice) throw new NotFoundError('Overlap not found.');
  const overlap = (invoice.manualOverlaps as Array<{ movementId: unknown; status: string }>).find(
    (item) => String(item.movementId) === input.movementId,
  );
  if (overlap?.status !== 'open') return; // already answered: a second click changes nothing

  if (input.action === 'undo') {
    const movement = await StockMovementDB.findOne({
      _id: toObjectId(input.movementId),
      storeId: store,
      type: 'purchase',
      'source.manualBatchId': { $exists: true },
    }).lean<LeanDoc | null>();
    if (!movement) throw new NotFoundError('Purchase not found.');
    await reverseLine(
      movement,
      new Date(),
      `Compra manual substituída pela nota ${invoice.number ?? input.accessKey}`,
    );
  }

  await ProcessedInvoiceDB.updateOne(
    { storeId: store, accessKey: input.accessKey },
    { $set: { 'manualOverlaps.$[item].status': input.action === 'undo' ? 'undone' : 'kept' } },
    { arrayFilters: [{ 'item.movementId': toObjectId(input.movementId) }] },
  );
}
