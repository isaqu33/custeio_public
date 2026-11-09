import { getBridgeConnection } from '@/app/lib/bridge-db';
import connectDB from '@/app/lib/connect-db';
import { env } from '@/app/lib/env';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { logger } from '@/app/lib/logger';
import { recordParsedDelivery } from '@/app/lib/services/pos-events';
import { enqueuePosOrderReceived } from '@/app/lib/services/pos-order-enqueue';
import StoreDB from '@/app/models/stores';

// The webhook bridge (custeio-webhook-bridge, docs/features/webhook-bridge.md) is a tiny
// always-on receiver that keeps Alloy's deliveries in its own MongoDB while this machine is off.
// This is the other half: bring what it kept into `pos_events`, through the same parser and the
// same de-duplication as the public webhook, and hand each new event to `pos.order.received`.
//
// The bridge never holds customer data (it masks it before storing), and it identifies the Store by
// `keyHash` — the sha256 of the webhook "Chave", the same value as `Stores.webhookKeyHash` — never
// by anything the delivery declares about itself.

const BATCH_SIZE = 200;
// One run takes at most this many batches, so a long backlog never holds the worker for long;
// the next run continues where this one stopped.
const MAX_BATCHES_PER_RUN = 5;
// A delivery that keeps failing to record is put aside after this many tries, so it cannot hold
// back the ones behind it. It stays on the bridge, listed on the errors view.
export const MAX_SYNC_ATTEMPTS = 3;

type BridgeEvent = {
  _id: unknown;
  keyHash: string;
  dedupeKey: string;
  payload: unknown;
  syncAttempts?: number;
};

type SyncResult = 'recorded' | 'duplicate' | 'ignored' | 'no_store' | 'error';

/** The slice of a MongoDB collection this module uses (a fake in the tests). */
export type BridgeCollection = {
  find(filter: Record<string, unknown>): {
    sort(order: Record<string, 1 | -1>): {
      limit(n: number): { toArray(): Promise<BridgeEvent[]> };
    };
  };
  updateOne(filter: { _id: unknown }, update: { $set: Record<string, unknown> }): Promise<unknown>;
};

export type BridgePullResult = {
  configured: boolean;
  /** How many events were read from the bridge in this run. */
  fetched: number;
  recorded: number;
  duplicate: number;
  ignored: number;
  /** Events whose key matches no Store (key rotated, or another install's webhook). */
  noStore: number;
  /** Events that failed to record in this run (put aside for good after MAX_SYNC_ATTEMPTS). */
  errors: number;
};

const emptyResult = (configured: boolean): BridgePullResult => ({
  configured,
  fetched: 0,
  recorded: 0,
  duplicate: 0,
  ignored: 0,
  noStore: 0,
  errors: 0,
});

type StoreRef = LeanDoc & { externalId?: string };

/** Looks a key up once per run: the same Store serves every delivery of that webhook. */
function storeLookup() {
  const stores = new Map<string, StoreRef | null>();
  return async (keyHash: string): Promise<StoreRef | null> => {
    if (!stores.has(keyHash)) {
      const store = await StoreDB.findOne({ provider: 'alloy', webhookKeyHash: keyHash })
        .select('_id externalId')
        .lean<StoreRef | null>();
      stores.set(keyHash, store);
    }
    return stores.get(keyHash) ?? null;
  };
}

/** Records one bridge event and, when it is new, hands it to the order job. */
async function recordBridgeEvent(event: BridgeEvent, store: StoreRef | null): Promise<SyncResult> {
  if (!store) return 'no_store';
  const recorded = await recordParsedDelivery({
    store,
    body: event.payload,
    dedupeKey: event.dedupeKey,
  });
  if (recorded.result === 'recorded') {
    if (recorded.eventId && recorded.storeId) {
      await enqueuePosOrderReceived({ storeId: recorded.storeId, eventId: recorded.eventId });
    }
    return 'recorded';
  }
  return recorded.result === 'duplicate' ? 'duplicate' : 'ignored';
}

const RESULT_FIELD: Record<
  SyncResult,
  'recorded' | 'duplicate' | 'ignored' | 'noStore' | 'errors'
> = {
  recorded: 'recorded',
  duplicate: 'duplicate',
  ignored: 'ignored',
  no_store: 'noStore',
  error: 'errors',
};

/** The local database or the network is down: not this event's fault, so it must not be blamed. */
function isInfrastructureError(err: unknown): boolean {
  const name = err instanceof Error ? `${err.name} ${err.constructor.name}` : '';
  return /ServerSelection|MongoNetwork|MongoNotConnected|MongoTopology|Timeout/i.test(name);
}

const shortMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err))
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, '[connection]')
    .slice(0, 300);

/**
 * An event that fails to record is counted and kept: after MAX_SYNC_ATTEMPTS it is marked
 * `syncResult: 'error'` with the message and no longer pulled, and the run goes on with the next.
 */
async function putAside(collection: BridgeCollection, event: BridgeEvent, err: unknown) {
  const attempts = (event.syncAttempts ?? 0) + 1;
  const giveUp = attempts >= MAX_SYNC_ATTEMPTS;
  logger.error(
    { err, bridgeEventId: String(event._id), attempts, giveUp },
    'bridge event failed to record',
  );
  await collection.updateOne(
    { _id: event._id },
    {
      $set: {
        syncAttempts: attempts,
        syncError: shortMessage(err),
        lastErrorAt: new Date(),
        ...(giveUp ? { syncedAt: new Date(), syncResult: 'error' } : {}),
      },
    },
  );
}

/**
 * Records one bridge event and marks it on the bridge. Trouble with the infrastructure ends the run
 * (nothing is blamed on the event); a problem with this one delivery puts it aside and the run goes
 * on with the next.
 */
async function syncEvent(
  collection: BridgeCollection,
  event: BridgeEvent,
  storeFor: (keyHash: string) => Promise<StoreRef | null>,
  result: BridgePullResult,
): Promise<void> {
  let outcome: SyncResult;
  try {
    outcome = await recordBridgeEvent(event, await storeFor(event.keyHash));
  } catch (err) {
    if (isInfrastructureError(err)) throw err;
    await putAside(collection, event, err);
    result.errors += 1;
    return;
  }
  result[RESULT_FIELD[outcome]] += 1;
  await collection.updateOne(
    { _id: event._id },
    { $set: { syncedAt: new Date(), syncResult: outcome } },
  );
}

/**
 * Reads the bridge's unsynced events oldest first (a delivery's status updates must arrive in
 * order) and syncs each one. Exported for tests.
 */
export async function pullFromCollection(collection: BridgeCollection): Promise<BridgePullResult> {
  const result = emptyResult(true);
  await connectDB();
  const storeFor = storeLookup();

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const events = await collection
      .find({ syncedAt: { $exists: false } })
      .sort({ receivedAt: 1, _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();

    for (const event of events) {
      result.fetched += 1;
      await syncEvent(collection, event, storeFor, result);
    }
    if (events.length < BATCH_SIZE) break;
  }
  return result;
}

/** The cron entry point: a no-op until `BRIDGE_MONGODB_URI` is set. */
export async function pullBridgeEvents(): Promise<BridgePullResult> {
  if (!env.BRIDGE_MONGODB_URI) return emptyResult(false);
  try {
    const conn = await getBridgeConnection();
    const collection = conn.collection('events') as unknown as BridgeCollection;
    return await pullFromCollection(collection);
  } catch (err) {
    logger.error({ err }, 'bridge pull failed');
    throw err;
  }
}
