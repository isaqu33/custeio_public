import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import {
  SEFAZ_POLL_DEFAULT_MINUTES,
  SEFAZ_POLL_MAX_MINUTES,
  SEFAZ_POLL_MIN_MINUTES,
  nextPollAt,
} from '@/app/lib/sefaz-sync-gate';
import { getSefazResumeAt } from '@/app/lib/services/sefaz-store-gate';
import OrganizationDB from '@/app/models/organizations';
import StoreDB from '@/app/models/stores';

export { SEFAZ_POLL_DEFAULT_MINUTES, SEFAZ_POLL_MAX_MINUTES, SEFAZ_POLL_MIN_MINUTES };

export type SefazPollingStore = {
  storeId: string;
  storeName: string;
  organizationId: string;
  organizationName: string;
  pollEnabled: boolean;
  pollIntervalMinutes: number;
  /** When the cron will next start this store (a poll or a backlog resume). */
  nextRunAt?: string;
  /** Documents were still waiting on SEFAZ when the last run stopped. */
  backlog: boolean;
  lastSyncAt?: string;
  lastError?: string;
  lastErrorAt?: string;
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : undefined);

/** Every store with how its automatic SEFAZ search is set, for System > Crons. */
export async function listSefazPollingStores(): Promise<SefazPollingStore[]> {
  await connectDB();
  const stores = await StoreDB.find({})
    .select(
      'name organizationId sefazPollEnabled sefazPollIntervalMinutes sefazResumeAt sefazBacklog sefazLastSyncAt sefazLastError sefazLastErrorAt',
    )
    .sort({ name: 1 })
    .limit(500)
    .lean<LeanDoc[]>();

  const organizations = await OrganizationDB.find({
    _id: { $in: [...new Set(stores.map((s) => String(s.organizationId)))].map(toObjectId) },
  })
    .select('name')
    .lean<LeanDoc[]>();
  const orgName = new Map(organizations.map((o) => [String(o._id), String(o.name ?? '')]));

  return stores.map((s) => ({
    storeId: String(s._id),
    storeName: String(s.name),
    organizationId: String(s.organizationId),
    organizationName: orgName.get(String(s.organizationId)) ?? '',
    pollEnabled: s.sefazPollEnabled === true,
    pollIntervalMinutes: Number(s.sefazPollIntervalMinutes ?? SEFAZ_POLL_DEFAULT_MINUTES),
    nextRunAt: iso(s.sefazResumeAt),
    backlog: s.sefazBacklog === true,
    lastSyncAt: iso(s.sefazLastSyncAt),
    lastError: s.sefazLastError ? String(s.sefazLastError) : undefined,
    lastErrorAt: iso(s.sefazLastErrorAt),
  }));
}

/**
 * Turns a store's automatic SEFAZ search on/off or changes its interval, and
 * moves the next run to match:
 *  - on: the next run is one interval after the last search (or now, if it never
 *    ran), and never before the gate reopens;
 *  - off: a scheduled poll is dropped, but a backlog keeps resuming — documents
 *    already waiting on SEFAZ are not abandoned by turning polling off.
 * Returns the organization id (for the audit trail), or `null` for an unknown store.
 */
export async function updateStorePolling(
  storeId: string,
  patch: { enabled?: boolean; intervalMinutes?: number },
): Promise<{ organizationId: string } | null> {
  await connectDB();
  const id = toObjectId(storeId);
  const current = await StoreDB.findById(id)
    .select(
      'organizationId sefazPollEnabled sefazPollIntervalMinutes sefazBacklog sefazLastSyncAt sefazResumeAt',
    )
    .lean<LeanDoc | null>();
  if (!current) return null;

  const enabled = patch.enabled ?? current.sefazPollEnabled === true;
  const intervalMinutes =
    patch.intervalMinutes ?? Number(current.sefazPollIntervalMinutes ?? SEFAZ_POLL_DEFAULT_MINUTES);
  const set: Record<string, unknown> = {
    sefazPollEnabled: enabled,
    sefazPollIntervalMinutes: intervalMinutes,
  };
  const unset: Record<string, ''> = {};

  if (current.sefazBacklog !== true) {
    if (enabled) {
      const now = new Date();
      const base = (current.sefazLastSyncAt as Date | undefined) ?? now;
      const at = nextPollAt(base, intervalMinutes, await getSefazResumeAt(storeId, now));
      set.sefazResumeAt = new Date(Math.max(at.getTime(), now.getTime()));
    } else {
      unset.sefazResumeAt = '';
    }
  }

  await StoreDB.updateOne(
    { _id: id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  );
  return { organizationId: String(current.organizationId) };
}
