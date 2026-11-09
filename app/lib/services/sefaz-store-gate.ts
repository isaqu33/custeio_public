import connectDB from '@/app/lib/connect-db';
import { env } from '@/app/lib/env';
import { toObjectId } from '@/app/lib/mongo-id';
import { evaluateSefazSyncGate, type SefazSyncGateResult } from '@/app/lib/sefaz-sync-gate';
import { getSefazUsageByStore } from '@/app/lib/services/sefaz-requests';
import StoreDB from '@/app/models/stores';

// Worker-safe (no `./errors`): both the claim route and the sync job read the
// same gate, and the job runs under plain tsx.

export type StoreGate = { lastSyncAt?: Date; gate: SefazSyncGateResult };

/**
 * The gate for one store, fed by its real usage log. `null` when the store does
 * not exist. `ignoreCooldown` is for a run that is already underway: the claim
 * that started it stamped `sefazLastSyncAt`, so the cooldown would refuse the run
 * its own next batch — only SEFAZ's block and the hourly quota matter mid-run.
 */
export async function evaluateStoreGate(
  storeId: string,
  now: Date,
  options: { ignoreCooldown?: boolean } = {},
): Promise<StoreGate | null> {
  await connectDB();
  const store = await StoreDB.findById(toObjectId(storeId))
    .select('sefazLastSyncAt')
    .lean<{ sefazLastSyncAt?: Date } | null>();
  if (!store) return null;

  const usage = (await getSefazUsageByStore([storeId], now)).get(storeId);
  const gate = evaluateSefazSyncGate({
    now,
    cooldownMs: options.ignoreCooldown ? 0 : env.SEFAZ_SYNC_COOLDOWN_MINUTES * 60_000,
    lastSyncAt: options.ignoreCooldown ? undefined : store.sefazLastSyncAt,
    blockedUntil: usage?.production.blockedUntil
      ? new Date(usage.production.blockedUntil)
      : undefined,
    usedLastHour: usage?.production.usedLastHour ?? 0,
  });
  return { lastSyncAt: store.sefazLastSyncAt, gate };
}

/** When the next run may start: now if the gate is open, else when it opens. */
export async function getSefazResumeAt(storeId: string, now: Date = new Date()): Promise<Date> {
  const evaluated = await evaluateStoreGate(storeId, now);
  if (!evaluated || evaluated.gate.allowed) return now;
  return new Date(now.getTime() + evaluated.gate.retryAfterSeconds * 1000);
}
