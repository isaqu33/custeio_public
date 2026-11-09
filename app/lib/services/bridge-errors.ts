import { getBridgeConnection, isBridgeConfigured } from '@/app/lib/bridge-db';
import { logger } from '@/app/lib/logger';
import { MAX_SYNC_ATTEMPTS } from '@/app/lib/services/bridge-pull';

// What went wrong around the webhook bridge, read straight from it (docs/features/webhook-bridge.md):
// events that failed to record and were put aside, events with a key no Store knows, and the
// deliveries the bridge refused. Read-only. Nothing here holds a payload, a key or customer data.

const REJECTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
// A page must not hang on an unreachable bridge.
const READ_TIMEOUT_MS = 6000;

export type BridgeQuarantinedEvent = {
  id: string;
  receivedAt?: string;
  event: string;
  orderRef?: string;
  attempts: number;
  error: string;
  lastErrorAt?: string;
};

export type BridgeRejectionSummary = {
  reason: string;
  total: number;
  last24h: number;
  lastAt?: string;
  status?: number;
  detail?: string;
};

export type BridgeErrorsView = {
  configured: boolean;
  /** The bridge could not be read (down, slow, wrong string). */
  unavailable: boolean;
  quarantined: BridgeQuarantinedEvent[];
  /** Failed at least once, still being retried. */
  retrying: number;
  noStore: { count: number; lastAt?: string };
  rejections: BridgeRejectionSummary[];
  maxAttempts: number;
};

type Doc = Record<string, unknown>;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : undefined);
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

const empty = (configured: boolean, unavailable = false): BridgeErrorsView => ({
  configured,
  unavailable,
  quarantined: [],
  retrying: 0,
  noStore: { count: 0 },
  rejections: [],
  maxAttempts: MAX_SYNC_ATTEMPTS,
});

async function read(): Promise<BridgeErrorsView> {
  const conn = await getBridgeConnection();
  const events = conn.collection('events');
  const errors = conn.collection('errors');
  const now = Date.now();

  const [quarantined, retrying, noStoreCount, noStoreLast, rejections] = await Promise.all([
    events.find({ syncResult: 'error' }).sort({ receivedAt: -1 }).limit(50).toArray() as Promise<
      Doc[]
    >,
    events.countDocuments({ syncError: { $exists: true }, syncedAt: { $exists: false } }),
    events.countDocuments({ syncResult: 'no_store' }),
    events.find({ syncResult: 'no_store' }).sort({ receivedAt: -1 }).limit(1).toArray() as Promise<
      Doc[]
    >,
    errors
      .aggregate([
        { $match: { bucket: { $gte: new Date(now - REJECTION_DAYS * DAY_MS) } } },
        { $sort: { lastAt: -1 } },
        {
          $group: {
            _id: '$reason',
            total: { $sum: '$count' },
            last24h: {
              $sum: { $cond: [{ $gte: ['$bucket', new Date(now - DAY_MS)] }, '$count', 0] },
            },
            lastAt: { $max: '$lastAt' },
            status: { $first: '$status' },
            detail: { $first: '$detail' },
          },
        },
        { $sort: { lastAt: -1 } },
      ])
      .toArray() as Promise<Doc[]>,
  ]);

  return {
    configured: true,
    unavailable: false,
    quarantined: quarantined.map((doc) => ({
      id: String(doc._id),
      receivedAt: iso(doc.receivedAt),
      event: str(doc.event) ?? '',
      orderRef: str(doc.externalOrderId),
      attempts: Number(doc.syncAttempts ?? 0),
      error: str(doc.syncError) ?? '',
      lastErrorAt: iso(doc.lastErrorAt),
    })),
    retrying,
    noStore: { count: noStoreCount, lastAt: iso(noStoreLast[0]?.receivedAt) },
    rejections: rejections.map((doc) => ({
      reason: String(doc._id),
      total: Number(doc.total ?? 0),
      last24h: Number(doc.last24h ?? 0),
      lastAt: iso(doc.lastAt),
      status: typeof doc.status === 'number' ? doc.status : undefined,
      detail: str(doc.detail),
    })),
    maxAttempts: MAX_SYNC_ATTEMPTS,
  };
}

/** The errors view for System > POS events. Never throws: an unreachable bridge is a state of its own. */
export async function getBridgeErrors(): Promise<BridgeErrorsView> {
  if (!isBridgeConfigured()) return empty(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('bridge read timed out')), READ_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    logger.error({ err }, 'could not read the bridge errors');
    return empty(true, true);
  } finally {
    clearTimeout(timer);
  }
}
