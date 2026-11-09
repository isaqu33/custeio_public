// Decides whether "Buscar na SEFAZ" may run now. Pure so the route and the
// tests share one rule. The point is the 20-queries/hour per-CNPJ ceiling
// (docs/features/sefaz-nfe.md): a 656 blocks the CNPJ for an hour and retrying
// early resets the block, so an owner mashing the button must be stopped before
// SEFAZ does it for us.

/** Real calls in the trailing hour at which we stop starting new syncs — a
 * margin under the 20/h ceiling, since one sync can make several calls. */
export const SEFAZ_SYNC_SAFE_HOURLY_CALLS = 15;

export type SefazSyncGateInput = {
  now: Date;
  cooldownMs: number;
  lastSyncAt?: Date;
  blockedUntil?: Date;
  usedLastHour: number;
};

export type SefazSyncGateResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'blocked' | 'cooldown' | 'quota';
      retryAfterSeconds: number;
    };

export function evaluateSefazSyncGate(input: SefazSyncGateInput): SefazSyncGateResult {
  const nowMs = input.now.getTime();
  const seconds = (untilMs: number) => Math.max(1, Math.ceil((untilMs - nowMs) / 1000));

  if (input.blockedUntil && input.blockedUntil.getTime() > nowMs) {
    return {
      allowed: false,
      reason: 'blocked',
      retryAfterSeconds: seconds(input.blockedUntil.getTime()),
    };
  }

  if (input.lastSyncAt) {
    const nextAt = input.lastSyncAt.getTime() + input.cooldownMs;
    if (nextAt > nowMs) {
      return { allowed: false, reason: 'cooldown', retryAfterSeconds: seconds(nextAt) };
    }
  }

  if (input.usedLastHour >= SEFAZ_SYNC_SAFE_HOURLY_CALLS) {
    // The oldest call leaves the sliding window within the hour; a full hour is
    // the conservative answer without re-deriving which call that is.
    return { allowed: false, reason: 'quota', retryAfterSeconds: 60 * 60 };
  }

  return { allowed: true };
}

/** Bounds for a store's polling interval, in minutes. The floor is a day-to-day
 * sanity limit; the real ceiling on how often SEFAZ is called is the gate. */
export const SEFAZ_POLL_MIN_MINUTES = 15;
export const SEFAZ_POLL_MAX_MINUTES = 24 * 60;
export const SEFAZ_POLL_DEFAULT_MINUTES = 60;

/**
 * Pure: when a store with polling on is next checked — one interval from now,
 * but never before the gate (cooldown, hourly quota, a SEFAZ block) reopens, so
 * the cron does not wake up just to be refused.
 */
export function nextPollAt(now: Date, intervalMinutes: number, gateOpensAt: Date): Date {
  const byInterval = now.getTime() + intervalMinutes * 60_000;
  return new Date(Math.max(byInterval, gateOpensAt.getTime()));
}
