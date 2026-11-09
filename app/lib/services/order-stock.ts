import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import {
  computeOrderConsumption,
  itemsRevenue,
  parseLocalTimestamp,
  type ConsumptionItem,
  type RecipeLine,
} from '@/app/lib/order-consumption';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { loadSharedRecipes } from '@/app/lib/services/shared-recipes';
import {
  deleteMovement,
  recordSaleMovement,
  recordSaleReversalMovement,
} from '@/app/lib/services/stock-movements';
import OrderDB from '@/app/models/orders';
import PartnerProductDB from '@/app/models/partner-products';
import PosEventDB from '@/app/models/pos-events';
import RawIngredientDB from '@/app/models/raw-ingredients';
import StockMovementDB from '@/app/models/stock-movements';

// pos.order.received: an order the PDV announced becomes an `Orders` row and, once the store
// accepted it, takes its recipes out of stock (docs/features/stock-and-cmv.md, "Half 2").
//
//   event ──▶ upsert Order ──▶ status ≥ 2 ? debit by recipe ──▶ cost and margin of the sale
//                          └─▶ cancellation ? give the stock back
//
// Idempotent end to end: the same order arrives in several events (new order, status changes,
// the iFood duplicate), and a unique index on (store, order, ingredient) lets each ingredient be
// debited once however often this runs. The movement is written before the stock moves and taken
// back if the move fails, like the invoice path.

export type ProcessEventResult =
  | { action: 'ignored' }
  | { action: 'saved'; externalOrderId: string }
  | {
      action: 'debited';
      externalOrderId: string;
      calculatedCost: number;
      incomplete: number;
    }
  | { action: 'already_debited'; externalOrderId: string }
  | {
      action: 'reprocessed';
      externalOrderId: string;
      calculatedCost: number;
      incomplete: number;
      changed: number;
    }
  | { action: 'reversed'; externalOrderId: string; ingredients: number }
  | { action: 'cancelled_before_debit'; externalOrderId: string };

/** Accepted, in transit or delivered: the store committed to make it, so the stock is committed. */
const ACCEPTED_FROM_STATUS = 2;

const normalize = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

type EventDoc = LeanDoc & {
  storeId: unknown;
  kind?: string;
  externalOrderId?: string;
  statusCode?: number;
  channel?: string;
  order?: {
    createdAt?: string;
    deliveryFee?: number;
    discount?: number;
    items?: Array<{
      quantity?: number;
      price?: number;
      codPdv?: string;
      name?: string;
      modifiers?: Array<{ quantity?: number; price?: number; codPdv?: string; name?: string }>;
    }>;
  };
};

type OrderDoc = LeanDoc & {
  storeId: unknown;
  externalOrderId: string;
  stockStatus?: 'pending' | 'debited' | 'reversed';
  stockRevision?: number;
  placedAt?: Date;
  totalValue?: number;
  items?: Array<{
    externalCode?: string;
    name?: string;
    quantity?: number;
    modifiers?: Array<{ externalCode?: string; name?: string; quantity?: number }>;
  }>;
};

export async function processPosEvent(eventId: string): Promise<ProcessEventResult> {
  await connectDB();
  const event = await PosEventDB.findById(toObjectId(eventId)).lean<EventDoc | null>();
  const ref = event?.externalOrderId;
  if (!event || !ref || !event.order || event.kind === 'unknown') return { action: 'ignored' };

  const storeId = String(event.storeId);
  await upsertOrder(storeId, ref, event);

  if (event.kind === 'cancellation') return reverseOrderStock(storeId, ref);
  if ((event.statusCode ?? 0) >= ACCEPTED_FROM_STATUS) return debitOrderStock(storeId, ref);
  return { action: 'saved', externalOrderId: ref };
}

async function upsertOrder(storeId: string, ref: string, event: EventDoc) {
  const order = event.order ?? {};
  const items = (order.items ?? []).map((item) => ({
    externalCode: String(item.codPdv ?? ''),
    name: String(item.name ?? ''),
    quantity: Number(item.quantity ?? 1),
    price: Number(item.price ?? 0),
    modifiers: (item.modifiers ?? []).map((modifier) => ({
      externalCode: String(modifier.codPdv ?? ''),
      name: String(modifier.name ?? ''),
      quantity: Number(modifier.quantity ?? 1),
      price: Number(modifier.price ?? 0),
    })),
  }));

  await OrderDB.updateOne(
    { storeId: toObjectId(storeId), externalOrderId: ref },
    {
      $set: {
        channel: event.channel ?? 'own',
        placedAt: parseLocalTimestamp(order.createdAt),
        items,
        deliveryFee: Number(order.deliveryFee ?? 0),
        discountValue: Number(order.discount ?? 0),
        totalValue: itemsRevenue(items),
      },
      // Events can arrive out of order: the status only ever moves forward.
      ...(event.statusCode !== undefined && { $max: { externalStatus: event.statusCode } }),
      $setOnInsert: { stockStatus: 'pending', calculatedCost: 0, profitMargin: 0 },
    },
    { upsert: true },
  );
}

/** name → PDV code, only where the catalog says one code for that name (an ambiguous name is not guessed). */
function uniqueCodes(pairs: Array<[string, string]>): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const [name, code] of pairs) {
    if (!name || !code) continue;
    const key = normalize(name);
    seen.set(key, (seen.get(key) ?? new Set()).add(code));
  }
  return new Map(
    [...seen].filter(([, codes]) => codes.size === 1).map(([k, c]) => [k, [...c][0]!]),
  );
}

type CatalogRow = LeanDoc & {
  name: string;
  codPdv?: string;
  recipe?: Array<{ rawIngredientId: unknown; quantity: number }>;
  modifiers?: Array<{ name: string; codPdv?: string }>;
};

/**
 * The recipe of each product sold and complement chosen. Saved by PDV code. The PDV does not always
 * send the code — the same "Fritas Combo" is `802` on one order and empty on the next, and some
 * promotions have no code at all — so an empty code is resolved by NAME through the catalog (only
 * when the name maps to a single code); a product still unresolved falls back to the recipe held on
 * the catalog row of that name.
 */
async function loadRecipes(storeId: string, items: ConsumptionItem[]) {
  const needsCatalog = items.some(
    (item) => !item.externalCode || item.modifiers.some((m) => !m.externalCode),
  );
  let productCode = new Map<string, string>();
  let modifierCode = new Map<string, string>();
  const rowRecipes = new Map<string, RecipeLine[]>();
  if (needsCatalog) {
    const rows = await PartnerProductDB.find({ storeId: toObjectId(storeId) })
      .select('name codPdv recipe modifiers.name modifiers.codPdv')
      .lean<CatalogRow[]>();
    productCode = uniqueCodes(rows.map((row) => [row.name, String(row.codPdv ?? '')]));
    modifierCode = uniqueCodes(
      rows.flatMap((row) =>
        (row.modifiers ?? []).map((m): [string, string] => [m.name, String(m.codPdv ?? '')]),
      ),
    );
    for (const row of rows) {
      if (row.recipe && row.recipe.length > 0) {
        rowRecipes.set(
          normalize(row.name),
          row.recipe.map((line) => ({
            rawIngredientId: String(line.rawIngredientId),
            quantity: Number(line.quantity),
          })),
        );
      }
    }
  }

  const productKey = (item: ConsumptionItem) =>
    item.externalCode || productCode.get(normalize(item.name)) || '';
  const modifierKey = (m: ConsumptionItem['modifiers'][number]) =>
    m.externalCode || modifierCode.get(normalize(m.name)) || '';

  const [sharedProducts, sharedModifiers] = await Promise.all([
    loadSharedRecipes(storeId, 'product', items.map(productKey)),
    loadSharedRecipes(
      storeId,
      'modifier',
      items.flatMap((item) => item.modifiers.map(modifierKey)),
    ),
  ]);

  const lines = (value: Array<{ rawIngredientId: unknown; quantity: number }> | undefined) =>
    value?.map((line) => ({
      rawIngredientId: String(line.rawIngredientId),
      quantity: Number(line.quantity),
    }));

  return {
    product: (item: ConsumptionItem) => {
      const code = productKey(item);
      return (
        (code ? lines(sharedProducts.get(code)) : undefined) ?? rowRecipes.get(normalize(item.name))
      );
    },
    modifier: (modifier: ConsumptionItem['modifiers'][number]) => {
      const code = modifierKey(modifier);
      return code ? lines(sharedModifiers.get(code)) : undefined;
    },
  };
}

type NetRow = { qty: number; value: number };

/**
 * What an order has taken from each ingredient so far: sales minus reversals, from the ledger — the
 * source of truth, so it stays right after a crash halfway through, a reprocess or a cancellation.
 */
async function netDebited(storeId: string, ref: string): Promise<Map<string, NetRow>> {
  const rows = await StockMovementDB.find({
    storeId: toObjectId(storeId),
    type: { $in: ['sale', 'reversal'] },
    'source.externalOrderId': ref,
  })
    .select('rawIngredientId type quantity value')
    .lean<
      Array<LeanDoc & { rawIngredientId: unknown; type: string; quantity: number; value?: number }>
    >();

  const net = new Map<string, NetRow>();
  for (const row of rows) {
    const id = String(row.rawIngredientId);
    const sign = row.type === 'sale' ? 1 : -1;
    const current = net.get(id) ?? { qty: 0, value: 0 };
    current.qty += sign * Math.abs(Number(row.quantity));
    current.value += sign * Number(row.value ?? 0);
    net.set(id, current);
  }
  return net;
}

/**
 * One ingredient of an order: writes the difference between what the recipes want and what the ledger
 * already shows. Returns whether the stock moved (false: nothing to settle, an id of another store, or a
 * row an earlier run had already written).
 */
async function settleIngredient(input: {
  storeId: string;
  ref: string;
  revision: number;
  occurredAt: Date;
  rawIngredientId: string;
  have: NetRow;
  wanted: number;
  cost: number | undefined;
}): Promise<boolean> {
  const delta = Number((input.wanted - input.have.qty).toFixed(3));
  if (Math.abs(delta) < 0.0005 || input.cost === undefined) return false;

  const common = {
    storeId: input.storeId,
    rawIngredientId: input.rawIngredientId,
    externalOrderId: input.ref,
    orderRevision: input.revision,
  };
  const movement =
    delta > 0
      ? await recordSaleMovement({
          ...common,
          occurredAt: input.occurredAt,
          quantity: delta,
          unitCost: input.cost,
        })
      : await recordSaleReversalMovement({
          ...common,
          quantity: -delta,
          unitCost: input.have.qty > 0 ? input.have.value / input.have.qty : input.cost,
        });
  if (movement === 'duplicate') return false;

  try {
    await RawIngredientDB.updateOne(
      { _id: toObjectId(input.rawIngredientId) },
      { $inc: { currentStock: -delta } },
    );
  } catch (err) {
    await deleteMovement(movement.id);
    throw err;
  }
  return true;
}

/**
 * Settles an order's stock against a TARGET (what its recipes say it uses now): only the difference
 * from what the ledger already shows is written — more is a `sale`, less is a `reversal` at the cost it
 * was taken at. A first debit, a reprocess after a recipe was added and a cancellation (target empty)
 * are all this one operation. Each row is unique per order, ingredient and revision, and is written
 * before the stock moves, then taken back if the move fails.
 */
async function settleOrderStock(input: {
  storeId: string;
  ref: string;
  revision: number;
  target: Map<string, number>;
  occurredAt: Date;
}): Promise<{ changed: number; cost: number }> {
  const store = toObjectId(input.storeId);
  const net = await netDebited(input.storeId, input.ref);
  const ids = [...new Set([...input.target.keys(), ...net.keys()])];
  const costs = new Map(
    (ids.length > 0
      ? await RawIngredientDB.find({ _id: { $in: toObjectIds(ids) }, storeId: store })
          .select('averageCost')
          .lean()
      : []
    ).map((doc: LeanDoc) => [String(doc._id), Number(doc.averageCost ?? 0)]),
  );

  let changed = 0;
  for (const id of ids) {
    const wrote = await settleIngredient({
      ...input,
      rawIngredientId: id,
      have: net.get(id) ?? { qty: 0, value: 0 },
      wanted: input.target.get(id) ?? 0,
      cost: costs.get(id),
    });
    if (wrote) changed++;
  }

  const after = await netDebited(input.storeId, input.ref);
  const cost = [...after.values()].reduce((sum, row) => sum + row.value, 0);
  return { changed, cost: Number(cost.toFixed(2)) };
}

/**
 * The recipes of an order's items as they stand now: what it should have taken, and what has no
 * recipe (so the cost is a floor, never a precise number).
 */
async function targetFor(storeId: string, order: OrderDoc) {
  const items: ConsumptionItem[] = (order.items ?? []).map((item) => ({
    externalCode: String(item.externalCode ?? ''),
    name: String(item.name ?? ''),
    quantity: Number(item.quantity ?? 1),
    modifiers: (item.modifiers ?? []).map((modifier) => ({
      externalCode: String(modifier.externalCode ?? ''),
      name: String(modifier.name ?? ''),
      quantity: Number(modifier.quantity ?? 1),
    })),
  }));
  return computeOrderConsumption(items, await loadRecipes(storeId, items));
}

async function writeSettled(
  order: OrderDoc,
  consumption: { missing: unknown[] },
  cost: number,
  firstDebit: boolean,
) {
  const revenue = Number(order.totalValue ?? 0);
  await OrderDB.updateOne(
    { _id: order._id },
    {
      $set: {
        stockStatus: 'debited',
        ...(firstDebit && { stockDebitedAt: new Date() }),
        calculatedCost: cost,
        profitMargin: revenue > 0 ? Number(((revenue - cost) / revenue).toFixed(4)) : 0,
        incompleteLines: consumption.missing,
      },
    },
  );
}

/** First debit of an accepted order. Re-running it (another event for the same order) changes nothing. */
export async function debitOrderStock(storeId: string, ref: string): Promise<ProcessEventResult> {
  await connectDB();
  const order = await OrderDB.findOne({
    storeId: toObjectId(storeId),
    externalOrderId: ref,
  }).lean<OrderDoc | null>();
  if (!order || order.stockStatus === 'reversed') return { action: 'ignored' };
  if (order.stockStatus === 'debited') return { action: 'already_debited', externalOrderId: ref };

  const consumption = await targetFor(storeId, order);
  const { cost } = await settleOrderStock({
    storeId,
    ref,
    revision: Number(order.stockRevision ?? 1),
    target: consumption.lines,
    occurredAt: order.placedAt ?? new Date(),
  });
  await writeSettled(order, consumption, cost, true);
  return {
    action: 'debited',
    externalOrderId: ref,
    calculatedCost: cost,
    incomplete: consumption.missing.length,
  };
}

/**
 * Settles an already-debited order again against the recipes as they are NOW — what makes an order that
 * was debited with `incompleteLines` right once the missing recipes are added. Only the difference is
 * written, and only one run can win the revision, so two clicks cannot settle it twice.
 */
export async function reprocessOrderStock(
  storeId: string,
  ref: string,
): Promise<ProcessEventResult> {
  await connectDB();
  const order = await OrderDB.findOne({
    storeId: toObjectId(storeId),
    externalOrderId: ref,
  }).lean<OrderDoc | null>();
  if (!order || order.stockStatus !== 'debited') return { action: 'ignored' };

  const current = Number(order.stockRevision ?? 1);
  const claimed = await OrderDB.updateOne(
    { _id: order._id, stockStatus: 'debited', stockRevision: current },
    { $set: { stockRevision: current + 1 } },
  );
  if (claimed.modifiedCount === 0) return { action: 'already_debited', externalOrderId: ref };

  const consumption = await targetFor(storeId, order);
  const { changed, cost } = await settleOrderStock({
    storeId,
    ref,
    revision: current + 1,
    target: consumption.lines,
    occurredAt: order.placedAt ?? new Date(),
  });
  await writeSettled(order, consumption, cost, false);
  return {
    action: 'reprocessed',
    externalOrderId: ref,
    calculatedCost: cost,
    incomplete: consumption.missing.length,
    changed,
  };
}

/** The PDV cancelled the order: whatever it took from stock goes back, once. */
export async function reverseOrderStock(storeId: string, ref: string): Promise<ProcessEventResult> {
  await connectDB();
  const order = await OrderDB.findOne({
    storeId: toObjectId(storeId),
    externalOrderId: ref,
  }).lean<OrderDoc | null>();
  if (!order || order.stockStatus === 'reversed') return { action: 'ignored' };

  const wasDebited = order.stockStatus === 'debited';
  const current = Number(order.stockRevision ?? 1);
  let revision = current;
  if (wasDebited) {
    const claimed = await OrderDB.updateOne(
      { _id: order._id, stockStatus: 'debited', stockRevision: current },
      { $set: { stockRevision: current + 1 } },
    );
    if (claimed.modifiedCount === 0) return { action: 'ignored' }; // another run is settling it
    revision = current + 1;
  }

  // An order cancelled before it was debited may still hold a half-finished first pass: settling
  // against an empty target gives that back too, and a late status event cannot debit it afterwards.
  const { changed } = await settleOrderStock({
    storeId,
    ref,
    revision,
    target: new Map(),
    occurredAt: new Date(),
  });
  await OrderDB.updateOne({ _id: order._id }, { $set: { stockStatus: 'reversed' } });
  return wasDebited
    ? { action: 'reversed', externalOrderId: ref, ingredients: changed }
    : { action: 'cancelled_before_debit', externalOrderId: ref };
}

/** Reprocesses every debited order of a store that still has lines without a recipe. */
export async function reprocessIncompleteOrders(
  storeId: string,
  limit = 200,
): Promise<{ reprocessed: number; stillIncomplete: number }> {
  await connectDB();
  const orders = await OrderDB.find({
    storeId: toObjectId(storeId),
    stockStatus: 'debited',
    'incompleteLines.0': { $exists: true },
  })
    .sort({ placedAt: -1 })
    .limit(limit)
    .select('externalOrderId')
    .lean<Array<LeanDoc & { externalOrderId: string }>>();

  let reprocessed = 0;
  let stillIncomplete = 0;
  for (const order of orders) {
    const result = await reprocessOrderStock(storeId, order.externalOrderId);
    if (result.action !== 'reprocessed') continue;
    reprocessed++;
    if (result.incomplete > 0) stillIncomplete++;
  }
  return { reprocessed, stillIncomplete };
}
