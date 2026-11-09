import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import StockMovementDB from '@/app/models/stock-movements';

// Worker-safe on purpose (models and plain helpers only): sefaz.nfe.received
// writes purchase movements from the Bull worker.

export type PurchaseMovementInput = {
  storeId: string;
  rawIngredientId: string;
  occurredAt: Date;
  /** In the ingredient's own unit. */
  quantity: number;
  /** Landed cost per stock unit (freight, other expenses and discounts spread in). */
  unitCost: number;
  /** Landed cost of the line. */
  value: number;
  source: {
    invoiceAccessKey: string;
    invoiceNumber?: string;
    invoiceSeries?: string;
    supplierCnpj: string;
    supplierName: string;
    supplierItemCode: string;
    description: string;
    itemIndex: number;
  };
};

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/**
 * Records one invoice line as a purchase. A duplicate means this exact line was
 * already credited by an earlier, half-finished run of the same invoice — the
 * caller must NOT credit it again. That is the whole point of writing the
 * movement before the credit.
 */
export async function recordPurchaseMovement(
  input: PurchaseMovementInput,
): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: 'purchase',
      occurredAt: input.occurredAt,
      quantity: input.quantity,
      unitCost: input.unitCost,
      value: input.value,
      source: input.source,
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

export type ManualPurchaseMovementInput = {
  storeId: string;
  rawIngredientId: string;
  occurredAt: Date;
  /** In the ingredient's own unit. */
  quantity: number;
  unitCost: number;
  value: number;
  userId?: string;
  note?: string;
  source: { supplierName: string; manualBatchId: string; itemIndex: number };
};

/**
 * Records one line of a purchase typed in by hand (a note the app cannot capture: an NFC-e, a
 * market receipt). Same contract as {@link recordPurchaseMovement}: a duplicate means this line of
 * this entry was already credited, so the caller must NOT credit it again.
 */
export async function recordManualPurchaseMovement(
  input: ManualPurchaseMovementInput,
): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: 'purchase',
      occurredAt: input.occurredAt,
      quantity: input.quantity,
      unitCost: input.unitCost,
      value: input.value,
      note: input.note,
      createdByUserId: input.userId,
      source: input.source,
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

export type SaleMovementInput = {
  storeId: string;
  rawIngredientId: string;
  externalOrderId: string;
  /** Which pass over the order this is (1 = first debit). */
  orderRevision: number;
  occurredAt: Date;
  /** Positive: how much the order used, in the ingredient's own unit. Stored negative. */
  quantity: number;
  /** The ingredient's average cost at that moment: a later purchase never rewrites it. */
  unitCost: number;
};

/**
 * Records what one order took out of one ingredient (type `sale`, negative). A duplicate means this
 * order already debited this ingredient — the caller must NOT take it out of stock again.
 */
export async function recordSaleMovement(
  input: SaleMovementInput,
): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: 'sale',
      occurredAt: input.occurredAt,
      quantity: -input.quantity,
      unitCost: input.unitCost,
      value: Number((input.quantity * input.unitCost).toFixed(4)),
      source: { externalOrderId: input.externalOrderId, orderRevision: input.orderRevision },
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

/**
 * One side of a batch of a preparation: the preparation itself (positive) or an ingredient it used
 * (negative). A duplicate means this batch was already registered for this ingredient.
 */
export async function recordProductionMovement(input: {
  storeId: string;
  rawIngredientId: string;
  batchId: string;
  /** Signed: positive for what was made, negative for what was used. */
  quantity: number;
  unitCost: number;
  note?: string;
  userId?: string;
}): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: 'production',
      occurredAt: new Date(),
      quantity: input.quantity,
      unitCost: input.unitCost,
      value: Number((input.quantity * input.unitCost).toFixed(4)),
      note: input.note,
      createdByUserId: input.userId,
      source: { batchId: input.batchId },
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

/**
 * One ingredient of an entry that takes stock out with no sale: `internal_use` (Consumo interno) or
 * `waste` (avaria). Negative, valued at the ingredient's average cost of that moment. A duplicate
 * means this entry already took this ingredient — the caller must NOT take it out of stock again.
 */
export type OutflowReason =
  | 'employee'
  | 'courtesy'
  | 'donation'
  | 'other'
  | 'expired'
  | 'breakage'
  | 'receiving_damage';

export async function recordOutflowMovement(input: {
  type: 'internal_use' | 'waste';
  storeId: string;
  rawIngredientId: string;
  entryId: string;
  /** Positive: how much was taken, in the ingredient's own unit. Stored negative. */
  quantity: number;
  unitCost: number;
  reason: OutflowReason;
  personName?: string;
  note?: string;
  userId?: string;
}): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: input.type,
      occurredAt: new Date(),
      quantity: -input.quantity,
      unitCost: input.unitCost,
      value: Number((input.quantity * input.unitCost).toFixed(4)),
      reason: input.reason,
      personName: input.personName,
      note: input.note,
      createdByUserId: input.userId,
      source: { entryId: input.entryId },
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

/**
 * Gives back stock an order had taken (cancelled, or reprocessed with less than before): positive,
 * valued at the cost it was taken at. Once per order, ingredient and revision.
 */
export async function recordSaleReversalMovement(input: {
  storeId: string;
  rawIngredientId: string;
  externalOrderId: string;
  orderRevision: number;
  /** Positive: what the sale had taken. */
  quantity: number;
  unitCost: number;
}): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(input.storeId),
      rawIngredientId: toObjectId(input.rawIngredientId),
      type: 'reversal',
      occurredAt: new Date(),
      quantity: input.quantity,
      unitCost: input.unitCost,
      value: Number((input.quantity * input.unitCost).toFixed(4)),
      source: { externalOrderId: input.externalOrderId, orderRevision: input.orderRevision },
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

/**
 * Records the reversal of one purchase line (its invoice was cancelled). Same
 * `source` as the purchase, opposite signs. A duplicate means this line was
 * already given back by an earlier run — the caller must NOT debit it again.
 */
export async function recordReversalMovement(
  purchase: PurchaseMovementInput,
  occurredAt: Date,
  note = 'NFe cancelada',
): Promise<{ id: string } | 'duplicate'> {
  await connectDB();
  try {
    const doc = await StockMovementDB.create({
      storeId: toObjectId(purchase.storeId),
      rawIngredientId: toObjectId(purchase.rawIngredientId),
      type: 'reversal',
      occurredAt,
      quantity: -purchase.quantity,
      unitCost: purchase.unitCost,
      value: -purchase.value,
      note,
      source: purchase.source,
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

export type LivePurchase = {
  occurredAt: Date;
  quantity: number;
  unitCost: number;
  supplierCnpj: string;
  supplierName: string;
  invoiceNumber?: string;
};

/**
 * The newest purchase of an ingredient that no reversal has undone — what its
 * "last purchase" and, with nothing in stock, its cost should fall back to.
 * Looks at the most recent purchases only: an ingredient whose last 25 purchases
 * were all cancelled is not a case worth a full scan.
 */
export async function getLatestLivePurchase(rawIngredientId: string): Promise<LivePurchase | null> {
  await connectDB();
  const id = toObjectId(rawIngredientId);
  const recent = await StockMovementDB.find({ rawIngredientId: id, type: 'purchase' })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(25)
    .lean<LeanDoc[]>();
  if (recent.length === 0) return null;

  // A purchase is identified by its invoice key, or by the entry id for a hand-typed one.
  const keyOf = (source: {
    invoiceAccessKey?: string;
    manualBatchId?: string;
    itemIndex?: number;
  }) => `${source.invoiceAccessKey ?? source.manualBatchId}:${source.itemIndex}`;
  type Src = { invoiceAccessKey?: string; manualBatchId?: string; itemIndex?: number };
  const reversals = await StockMovementDB.find({
    rawIngredientId: id,
    type: 'reversal',
    $or: [
      {
        'source.invoiceAccessKey': {
          $in: recent.map((m) => (m.source as Src)?.invoiceAccessKey).filter(Boolean),
        },
      },
      {
        'source.manualBatchId': {
          $in: recent.map((m) => (m.source as Src)?.manualBatchId).filter(Boolean),
        },
      },
    ],
  })
    .select('source.invoiceAccessKey source.manualBatchId source.itemIndex')
    .lean<LeanDoc[]>();
  const reversed = new Set(reversals.map((m) => keyOf(m.source as Src)));

  const live = recent.find((m) => !reversed.has(keyOf(m.source as Src)));
  if (!live) return null;
  const source = (live.source ?? {}) as Record<string, string | undefined>;
  return {
    occurredAt: live.occurredAt as Date,
    quantity: Number(live.quantity),
    unitCost: Number(live.unitCost ?? 0),
    supplierCnpj: source.supplierCnpj ?? '',
    supplierName: source.supplierName ?? '',
    invoiceNumber: source.invoiceNumber,
  };
}

/** Undoes a movement whose credit then failed, so a retry can apply the line again. */
export async function deleteMovement(id: string): Promise<void> {
  await connectDB();
  await StockMovementDB.deleteOne({ _id: toObjectId(id) });
}

/** A person set the balance (a count, or a manual edit): the change is kept, with before and after. */
export async function recordAdjustmentMovement(input: {
  storeId: string;
  rawIngredientId: string;
  balanceBefore: number;
  balanceAfter: number;
  note?: string;
  userId?: string;
}): Promise<void> {
  await connectDB();
  await StockMovementDB.create({
    storeId: toObjectId(input.storeId),
    rawIngredientId: toObjectId(input.rawIngredientId),
    type: 'adjustment',
    occurredAt: new Date(),
    quantity: input.balanceAfter - input.balanceBefore,
    balanceBefore: input.balanceBefore,
    balanceAfter: input.balanceAfter,
    note: input.note,
    createdByUserId: input.userId,
  });
}

export type MovementListItem = {
  _id: string;
  type: 'purchase' | 'reversal' | 'adjustment' | 'sale' | 'production' | 'internal_use' | 'waste';
  occurredAt: string;
  quantity: number;
  unitCost?: number;
  value?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  note?: string;
  /** Internal use only. */
  reason?: string;
  personName?: string;
  supplierName?: string;
  supplierCnpj?: string;
  invoiceNumber?: string;
  invoiceSeries?: string;
  description?: string;
  /** Unit cost against the previous purchase, in %. Only on purchases that have one before them. */
  priceChangePercent?: number;
};

/**
 * Puts each purchase's price move against the one before it. `items` must be
 * newest first; adjustments are skipped over (they have no price).
 */
export function withPriceChanges(items: MovementListItem[]): MovementListItem[] {
  return items.map((item, index) => {
    if (item.type !== 'purchase' || !item.unitCost) return item;
    const previous = items
      .slice(index + 1)
      .find((older) => older.type === 'purchase' && older.unitCost);
    if (!previous?.unitCost) return item;
    return { ...item, priceChangePercent: (item.unitCost / previous.unitCost - 1) * 100 };
  });
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : Number(value);
}

function toListItem(doc: LeanDoc): MovementListItem {
  const source = (doc.source ?? {}) as Record<string, string | undefined>;
  return {
    _id: String(doc._id),
    type: doc.type as MovementListItem['type'],
    occurredAt: (doc.occurredAt as Date).toISOString(),
    quantity: Number(doc.quantity),
    unitCost: optionalNumber(doc.unitCost),
    value: optionalNumber(doc.value),
    balanceBefore: optionalNumber(doc.balanceBefore),
    balanceAfter: optionalNumber(doc.balanceAfter),
    note: doc.note ? String(doc.note) : undefined,
    reason: doc.reason ? String(doc.reason) : undefined,
    personName: doc.personName ? String(doc.personName) : undefined,
    supplierName: source.supplierName,
    supplierCnpj: source.supplierCnpj,
    invoiceNumber: source.invoiceNumber,
    invoiceSeries: source.invoiceSeries,
    description: source.description,
  };
}

export type SupplierOption = { cnpj: string; name: string };

/** Every supplier this store has ever bought from, for the ingredients filter —
 * newest purchase's name per CNPJ, in case a trade name changed. */
export async function getSupplierOptionsForStore(storeId: string): Promise<SupplierOption[]> {
  await connectDB();
  const rows = await StockMovementDB.aggregate<{ _id: string; name?: string }>([
    { $match: { storeId: toObjectId(storeId), type: 'purchase' } },
    { $sort: { occurredAt: -1 } },
    { $group: { _id: '$source.supplierCnpj', name: { $first: '$source.supplierName' } } },
  ]);
  return rows
    .filter((row) => row._id)
    .map((row) => ({ cnpj: row._id, name: row.name || row._id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Ingredients ever purchased from this supplier — the filter's "Fornecedor" narrows to these. */
export async function getRawIngredientIdsForSupplier(
  storeId: string,
  supplierCnpj: string,
): Promise<string[]> {
  await connectDB();
  const ids = await StockMovementDB.distinct('rawIngredientId', {
    storeId: toObjectId(storeId),
    type: 'purchase',
    'source.supplierCnpj': supplierCnpj,
  });
  return ids.map(String);
}

/** One ingredient's history, newest first, with each purchase's price move. */
export async function listMovementsForIngredient(
  ingredientId: string,
  limit = 100,
): Promise<MovementListItem[]> {
  await connectDB();
  const docs = await StockMovementDB.find({ rawIngredientId: toObjectId(ingredientId) })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return withPriceChanges(docs.map((doc: LeanDoc) => toListItem(doc)));
}
