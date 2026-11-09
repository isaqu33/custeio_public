import { env } from '@/app/lib/env';
import { NotFoundError, TooManyRequestsError } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import type { SefazSyncGateResult } from '@/app/lib/sefaz-sync-gate';
import { evaluateStoreGate } from '@/app/lib/services/sefaz-store-gate';
import StoreDB from '@/app/models/stores';

export type SefazSyncAvailability = {
  lastSyncAt?: string;
  // Set only while the button must stay disabled; the moment it may be pressed again.
  nextAllowedAt?: string;
  reason?: 'blocked' | 'cooldown' | 'quota';
};

/** Retry policy for a SEFAZ-sync job, shared by the button and the resume cron. One
 * attempt on purpose: the NSU cursor is saved per batch, so a later run resumes;
 * an automatic retry would instead spend more of the per-CNPJ SEFAZ quota on the
 * same failure. */
export const SEFAZ_SYNC_JOB_CONFIG = {
  attempts: 1,
  backoff: { type: 'fixed' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};

const cooldownMs = () => env.SEFAZ_SYNC_COOLDOWN_MINUTES * 60_000;

async function evaluate(
  storeId: string,
  now: Date,
): Promise<{ lastSyncAt?: Date; gate: SefazSyncGateResult }> {
  const evaluated = await evaluateStoreGate(storeId, now);
  if (!evaluated) throw new NotFoundError('Store not found.');
  return evaluated;
}

/** What the Stock page needs to label/disable "Buscar na SEFAZ". Read-only. */
export async function getSefazSyncAvailability(
  storeId: string,
  now: Date = new Date(),
): Promise<SefazSyncAvailability> {
  const { lastSyncAt, gate } = await evaluate(storeId, now);
  return {
    lastSyncAt: lastSyncAt?.toISOString(),
    ...(gate.allowed
      ? {}
      : {
          reason: gate.reason,
          nextAllowedAt: new Date(now.getTime() + gate.retryAfterSeconds * 1000).toISOString(),
        }),
  };
}

function refusal(gate: Extract<SefazSyncGateResult, { allowed: false }>): TooManyRequestsError {
  const minutes = Math.ceil(gate.retryAfterSeconds / 60);
  const why = {
    blocked: 'SEFAZ blocked this CNPJ for improper use',
    cooldown: 'A SEFAZ search for this store ran recently',
    quota: 'This CNPJ is close to the SEFAZ hourly query limit',
  }[gate.reason];
  return new TooManyRequestsError(`${why}. Try again in ${minutes} min.`);
}

/**
 * Gate + claim, in one step: throws 429 while the store is cooling down,
 * blocked or near the hourly ceiling; otherwise stamps `sefazLastSyncAt` so a
 * second request an instant later is refused too. The stamp is a conditional
 * update, so two simultaneous clicks cannot both win.
 */
export async function claimSefazSync(storeId: string, now: Date = new Date()): Promise<void> {
  const { gate } = await evaluate(storeId, now);
  if (!gate.allowed) throw refusal(gate);

  const threshold = new Date(now.getTime() - cooldownMs());
  const claimed = await StoreDB.findOneAndUpdate(
    {
      _id: toObjectId(storeId),
      $or: [
        { sefazLastSyncAt: { $exists: false } },
        { sefazLastSyncAt: null },
        { sefazLastSyncAt: { $lte: threshold } },
      ],
    },
    { $set: { sefazLastSyncAt: now } },
  ).lean();

  if (!claimed) {
    // Lost the race to a concurrent click: report the cooldown that click started.
    const { gate: after } = await evaluate(storeId, now);
    throw after.allowed
      ? new TooManyRequestsError('A SEFAZ search for this store just started.')
      : refusal(after);
  }
}
