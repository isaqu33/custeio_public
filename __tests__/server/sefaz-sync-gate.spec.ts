/**
 * @jest-environment node
 */
export {};

import { evaluateSefazSyncGate, SEFAZ_SYNC_SAFE_HOURLY_CALLS } from '@/app/lib/sefaz-sync-gate';

const NOW = new Date('2026-09-24T18:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000);
const HOUR = 60 * 60_000;

describe('evaluateSefazSyncGate', () => {
  it('allows the first ever sync', () => {
    expect(evaluateSefazSyncGate({ now: NOW, cooldownMs: HOUR, usedLastHour: 0 })).toEqual({
      allowed: true,
    });
  });

  it('refuses inside the cooldown and says how long is left', () => {
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: HOUR,
        lastSyncAt: minutesAgo(20),
        usedLastHour: 0,
      }),
    ).toEqual({ allowed: false, reason: 'cooldown', retryAfterSeconds: 40 * 60 });
  });

  it('allows again once the cooldown has passed', () => {
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: HOUR,
        lastSyncAt: minutesAgo(61),
        usedLastHour: 0,
      }).allowed,
    ).toBe(true);
  });

  it('a 656 block wins over everything else', () => {
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: 0,
        blockedUntil: minutesAhead(30),
        usedLastHour: 0,
      }),
    ).toEqual({ allowed: false, reason: 'blocked', retryAfterSeconds: 30 * 60 });
  });

  it('ignores a block that already ended', () => {
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: 0,
        blockedUntil: minutesAgo(1),
        usedLastHour: 0,
      }).allowed,
    ).toBe(true);
  });

  it('stops near the hourly ceiling, before SEFAZ does', () => {
    const result = evaluateSefazSyncGate({
      now: NOW,
      cooldownMs: 0,
      usedLastHour: SEFAZ_SYNC_SAFE_HOURLY_CALLS,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'quota' });
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: 0,
        usedLastHour: SEFAZ_SYNC_SAFE_HOURLY_CALLS - 1,
      }).allowed,
    ).toBe(true);
  });

  it('a zero cooldown (dev) never blocks on time alone', () => {
    expect(
      evaluateSefazSyncGate({
        now: NOW,
        cooldownMs: 0,
        lastSyncAt: NOW,
        usedLastHour: 0,
      }).allowed,
    ).toBe(true);
  });
});

describe('nextPollAt', () => {
  const now = new Date('2026-09-24T18:00:00.000Z');

  it('is one interval away when the gate is already open', async () => {
    const { nextPollAt } = await import('@/app/lib/sefaz-sync-gate');
    expect(nextPollAt(now, 60, now)).toEqual(new Date('2026-09-24T19:00:00.000Z'));
  });

  it('waits for the gate when it opens later than the interval', async () => {
    const { nextPollAt } = await import('@/app/lib/sefaz-sync-gate');
    const opens = new Date('2026-09-24T21:00:00.000Z');
    expect(nextPollAt(now, 60, opens)).toEqual(opens);
  });
});
