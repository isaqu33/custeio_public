import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import RawIngredientDB from '@/app/models/raw-ingredients';
import StockMovementDB from '@/app/models/stock-movements';

// Worker-safe (no `./errors`): runs from the Bull worker right after an invoice is captured.

/** A hand-typed purchase counts as "the same delivery" within this many days of the invoice date. */
const WINDOW_DAYS = 7;
/** ...and when its quantity is within this share of the invoice line's. */
const QUANTITY_TOLERANCE = 0.15;
const DAY_MS = 24 * 60 * 60 * 1000;

type Store = ReturnType<typeof toObjectId>;

/** Hand-typed purchases close to one invoice line that no invoice has claimed and nobody undid. */
async function manualCandidatesFor(
  store: Store,
  line: LeanDoc,
  issuedAt: Date,
  claimed: Set<string>,
): Promise<LeanDoc[]> {
  const quantity = Number(line.quantity);
  if (!(quantity > 0)) return [];
  const candidates = await StockMovementDB.find({
    storeId: store,
    rawIngredientId: toObjectId(String(line.rawIngredientId)),
    type: 'purchase',
    'source.manualBatchId': { $exists: true },
    occurredAt: {
      $gte: new Date(issuedAt.getTime() - WINDOW_DAYS * DAY_MS),
      $lte: new Date(issuedAt.getTime() + WINDOW_DAYS * DAY_MS),
    },
    quantity: {
      $gte: quantity * (1 - QUANTITY_TOLERANCE),
      $lte: quantity * (1 + QUANTITY_TOLERANCE),
    },
  }).lean<LeanDoc[]>();

  const open: LeanDoc[] = [];
  for (const candidate of candidates) {
    if (claimed.has(String(candidate._id))) continue;
    const source = candidate.source as { manualBatchId: string; itemIndex?: number };
    const undone = await StockMovementDB.exists({
      storeId: store,
      type: 'reversal',
      'source.manualBatchId': source.manualBatchId,
      'source.itemIndex': source.itemIndex,
    });
    if (!undone) open.push(candidate);
  }
  return open;
}

async function toOverlap(movement: LeanDoc) {
  const ingredient = await RawIngredientDB.findById(movement.rawIngredientId)
    .select('name unit')
    .lean<LeanDoc | null>();
  return {
    movementId: movement._id,
    rawIngredientId: movement.rawIngredientId,
    ingredientName: String(ingredient?.name ?? ''),
    unit: String(ingredient?.unit ?? 'un'),
    supplierName: String((movement.source as { supplierName?: string })?.supplierName ?? ''),
    occurredAt: movement.occurredAt,
    quantity: Number(movement.quantity),
    value: Number(movement.value ?? 0),
    status: 'open',
  };
}

/** Movement ids another invoice already flagged, so one manual entry is offered once. */
async function claimedMovementIds(store: Store): Promise<Set<string>> {
  const invoices = await ProcessedInvoiceDB.find({
    storeId: store,
    'manualOverlaps.0': { $exists: true },
  })
    .select('manualOverlaps.movementId')
    .lean<Array<{ manualOverlaps: Array<{ movementId: unknown }> }>>();
  return new Set(
    invoices.flatMap((invoice) => invoice.manualOverlaps.map((item) => String(item.movementId))),
  );
}

/**
 * "Registrar compra" credits the stock the day the goods arrive; the invoice, issued that day,
 * reaches SEFAZ later and credits it again. Nothing can tell for sure that two entries are one
 * delivery, so this only LOOKS: for each line of a just-captured invoice it finds hand-typed
 * purchases of the same ingredient close in date and quantity, and writes them on the invoice as
 * `manualOverlaps` (open). The owner then undoes the manual one or keeps both
 * (resolveManualOverlap). Nothing is changed in stock here.
 */
export async function flagManualOverlaps(
  storeId: string,
  accessKey: string,
  issuedAt: Date,
): Promise<number> {
  await connectDB();
  const store = toObjectId(storeId);
  const lines = await StockMovementDB.find({
    storeId: store,
    type: 'purchase',
    'source.invoiceAccessKey': accessKey,
  }).lean<LeanDoc[]>();
  if (lines.length === 0) return 0;

  const claimed = await claimedMovementIds(store);
  const found: Array<Awaited<ReturnType<typeof toOverlap>>> = [];
  for (const line of lines) {
    for (const movement of await manualCandidatesFor(store, line, issuedAt, claimed)) {
      claimed.add(String(movement._id));
      found.push(await toOverlap(movement));
    }
  }

  if (found.length > 0) {
    await ProcessedInvoiceDB.updateOne(
      { storeId: store, accessKey },
      { $set: { manualOverlaps: found } },
    );
  }
  return found.length;
}
