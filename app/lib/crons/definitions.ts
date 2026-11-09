import { env } from '@/app/lib/env';

// What recurring tasks exist and how they may be tuned. Pure metadata: the code
// that runs them is in handlers.ts (worker only), so the Crons screen and its API
// can read this without loading the queue.

export const CronKey = {
  SEFAZ_AUTO_SYNC: 'sefaz.auto-sync',
  QUEUE_CLEANUP: 'queue.cleanup',
  BRIDGE_PULL: 'bridge.pull',
} as const;

export type CronKey = (typeof CronKey)[keyof typeof CronKey];

export type CronDefinition = {
  key: CronKey;
  /** Seed values, used only the first time the task is read. */
  defaultEnabled: boolean;
  defaultIntervalMinutes: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
};

const DAY = 24 * 60;

export function getCronDefinitions(): CronDefinition[] {
  return [
    {
      // Resumes SEFAZ syncs that stopped with documents waiting, and polls the
      // stores that have automatic search on. SEFAZ_RESUME_INTERVAL_MINUTES=0 was
      // the old "off" switch, so it still seeds the task as paused.
      key: CronKey.SEFAZ_AUTO_SYNC,
      defaultEnabled: env.SEFAZ_RESUME_INTERVAL_MINUTES > 0,
      defaultIntervalMinutes: Math.max(1, env.SEFAZ_RESUME_INTERVAL_MINUTES || 5),
      minIntervalMinutes: 1,
      maxIntervalMinutes: DAY,
    },
    {
      // Removes failed Bull jobs older than APP_BULL_FAILED_JOB_TTL_DAYS.
      key: CronKey.QUEUE_CLEANUP,
      defaultEnabled: true,
      defaultIntervalMinutes: Math.max(1, env.APP_BULL_CLEANUP_INTERVAL_HOURS * 60),
      minIntervalMinutes: 5,
      maxIntervalMinutes: 7 * DAY,
    },
    {
      // Brings the PDV deliveries the webhook bridge kept while this machine was off. Off until the
      // bridge's connection string is set.
      key: CronKey.BRIDGE_PULL,
      defaultEnabled: Boolean(env.BRIDGE_MONGODB_URI),
      defaultIntervalMinutes: 2,
      minIntervalMinutes: 1,
      maxIntervalMinutes: DAY,
    },
  ];
}

export function isCronKey(value: string): value is CronKey {
  return Object.values(CronKey).includes(value as CronKey);
}
