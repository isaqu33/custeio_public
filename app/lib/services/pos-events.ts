import crypto from 'node:crypto';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { extractWebhookKey, parseAlloyWebhook, type PosEventKind } from '@/app/lib/alloy-webhook';
import { logger } from '@/app/lib/logger';
import { toObjectId } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import { containsCondition } from '@/app/lib/search-regex';
import PosEventDB from '@/app/models/pos-events';
import StoreDB from '@/app/models/stores';

export type RecordWebhookResult = 'recorded' | 'duplicate' | 'ignored' | 'unauthorized';

/** `eventId` and `storeId` are set only when a new event was recorded: what the order job needs. */
export type RecordWebhookOutcome = {
  result: RecordWebhookResult;
  eventId?: string;
  storeId?: string;
};

export const hashWebhookKey = (key: string) =>
  crypto.createHash('sha256').update(key).digest('hex');

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Records one Alloy webhook delivery. The "Chave" the owner typed in Alloy is what
 * identifies the Store (by hash), so a delivery is accepted only when that key is known —
 * never by the `loja_id` it declares. The validation ping Alloy sends when a webhook is
 * created (`{}`) is accepted but records nothing.
 */
export async function recordAlloyWebhook(input: {
  authorization: string | null;
  rawBody: string;
}): Promise<RecordWebhookOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    body = undefined;
  }

  const key = extractWebhookKey(input.authorization, body);
  if (!key) return { result: 'unauthorized' };

  await connectDB();
  const store = await StoreDB.findOne({ provider: 'alloy', webhookKeyHash: hashWebhookKey(key) })
    .select('_id externalId')
    .lean<(LeanDoc & { externalId?: string }) | null>();
  if (!store) return { result: 'unauthorized' };

  return recordParsedDelivery({
    store,
    body,
    dedupeKey: crypto.createHash('sha256').update(input.rawBody).digest('hex'),
  });
}

/**
 * Classifies one delivery of a known Store and records it. Shared by the public webhook and by
 * the bridge pull (`bridge-pull.ts`), so both go through the same parser and the same
 * de-duplication: `dedupeKey` is the hash of the raw body, which the bridge also computes.
 */
export async function recordParsedDelivery(input: {
  store: LeanDoc & { externalId?: string };
  body: unknown;
  dedupeKey: string;
}): Promise<RecordWebhookOutcome> {
  const { store, body, dedupeKey } = input;
  const parsed = parseAlloyWebhook(body);
  if (!parsed) return { result: 'ignored' };

  if (parsed.externalStoreId && parsed.externalStoreId !== String(store.externalId ?? '')) {
    logger.warn(
      { storeId: String(store._id), declared: parsed.externalStoreId, stored: store.externalId },
      'webhook loja_id differs from the store externalId',
    );
  }

  try {
    const created = await PosEventDB.create({
      storeId: toObjectId(String(store._id)),
      kind: parsed.kind,
      event: parsed.event,
      externalStoreId: parsed.externalStoreId,
      externalOrderId: parsed.externalOrderId,
      statusCode: parsed.statusCode,
      statusLabel: parsed.statusLabel,
      channel: parsed.channel,
      order: parsed.order,
      payload: parsed.payload,
      dedupeKey,
    });
    return { result: 'recorded', eventId: String(created._id), storeId: String(store._id) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { result: 'duplicate' };
    throw err;
  }
}

export type PosEventKindFilter = PosEventKind | 'all';

export type PosEventItem = {
  _id: string;
  receivedAt: string;
  kind: PosEventKind;
  event: string;
  externalOrderId?: string;
  statusCode?: number;
  statusLabel?: string;
  channel: string;
  total?: number;
  paymentMethod?: string;
  /** "1x João Smash (+ Ao Ponto, Fritas Extra)" per line. */
  items: Array<{ quantity: number; name: string; modifiers: string[] }>;
  /** The delivery as received, customer data masked. */
  payload?: unknown;
  demo: boolean;
};

export type PosEventsPage = {
  data: PosEventItem[];
  total: number;
  page: number;
  totalPages: number;
};

type PosEventDoc = LeanDoc & {
  receivedAt?: Date;
  kind?: PosEventKind;
  event?: string;
  externalOrderId?: string;
  statusCode?: number;
  statusLabel?: string;
  channel?: string;
  demo?: boolean;
  payload?: unknown;
  order?: {
    total?: number;
    paymentMethod?: string;
    items?: Array<{
      quantity?: number;
      name?: string;
      modifiers?: Array<{ name?: string; quantity?: number }>;
    }>;
  };
};

function toItem(doc: PosEventDoc): PosEventItem {
  return {
    _id: String(doc._id),
    receivedAt: (doc.receivedAt ?? new Date(0)).toISOString(),
    kind: doc.kind ?? 'unknown',
    event: String(doc.event ?? ''),
    externalOrderId: doc.externalOrderId,
    statusCode: doc.statusCode,
    statusLabel: doc.statusLabel,
    channel: String(doc.channel ?? 'own'),
    total: doc.order?.total,
    paymentMethod: doc.order?.paymentMethod,
    items: (doc.order?.items ?? []).map((item) => ({
      quantity: Number(item.quantity ?? 1),
      name: String(item.name ?? ''),
      modifiers: (item.modifiers ?? []).map(
        (modifier) =>
          `${Number(modifier.quantity ?? 1) > 1 ? `${modifier.quantity}x ` : ''}${modifier.name ?? ''}`,
      ),
    })),
    payload: doc.payload,
    demo: doc.demo === true,
  };
}

/** One page of a store's PDV events, newest first, for the "Eventos do PDV" page. */
export async function getPosEventsPageForStore(
  storeId: string,
  params: { page?: number; limit?: number; kind?: PosEventKindFilter; q?: string } = {},
): Promise<PosEventsPage> {
  await connectDB();
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 25;
  const term = params.q?.trim();
  const query = {
    storeId: toObjectId(storeId),
    ...(params.kind && params.kind !== 'all' && { kind: params.kind }),
    // An order reference ("1527") or part of a product / complement name.
    ...(term && {
      $or: [
        { externalOrderId: term.replace(/^#/, '') },
        { 'order.items.name': containsCondition(term) },
        { 'order.items.modifiers.name': containsCondition(term) },
      ],
    }),
  };
  const [docs, total] = await Promise.all([
    PosEventDB.find(query)
      .select('-dedupeKey')
      .sort({ receivedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<PosEventDoc[]>(),
    PosEventDB.countDocuments(query),
  ]);
  return { data: docs.map(toItem), total, page, totalPages: totalPages(total, limit) };
}
