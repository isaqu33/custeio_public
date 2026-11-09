import connectDB from '@/app/lib/connect-db';
import { type CronDefinition, type CronKey, getCronDefinitions } from '@/app/lib/crons/definitions';
import { logger } from '@/app/lib/logger';
import { beginCronRunRecord, endCronRunRecord } from '@/app/lib/services/cron-job-records';
import CronSettingsDB from '@/app/models/cron-settings';

// Worker-safe (no `./errors`, no session): the worker's scheduler claims and runs
// crons through here, and the Crons API reads and tunes the same rows.

export type CronRow = {
  key: CronKey;
  enabled: boolean;
  intervalMinutes: number;
  defaultIntervalMinutes: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  lastRunAt?: string;
  lastDurationMs?: number;
  lastResult?: string;
  lastError?: string;
  /** When the next run is due; absent while paused. */
  nextRunAt?: string;
};

type LeanSetting = {
  key: CronKey;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: Date;
  lastDurationMs?: number;
  lastResult?: string;
  lastError?: string;
};

const MINUTE = 60_000;

/** Pure: the row the screen shows for one stored setting. */
export function toCronRow(definition: CronDefinition, setting: LeanSetting): CronRow {
  const nextRunAt = setting.enabled
    ? new Date((setting.lastRunAt?.getTime() ?? Date.now()) + setting.intervalMinutes * MINUTE)
    : undefined;
  return {
    key: definition.key,
    enabled: setting.enabled,
    intervalMinutes: setting.intervalMinutes,
    defaultIntervalMinutes: definition.defaultIntervalMinutes,
    minIntervalMinutes: definition.minIntervalMinutes,
    maxIntervalMinutes: definition.maxIntervalMinutes,
    lastRunAt: setting.lastRunAt?.toISOString(),
    lastDurationMs: setting.lastDurationMs,
    lastResult: setting.lastResult,
    lastError: setting.lastError,
    nextRunAt: nextRunAt?.toISOString(),
  };
}

/** Creates the row with its defaults the first time a cron is looked at. */
async function ensureSetting(definition: CronDefinition): Promise<void> {
  await CronSettingsDB.updateOne(
    { key: definition.key },
    {
      $setOnInsert: {
        enabled: definition.defaultEnabled,
        intervalMinutes: definition.defaultIntervalMinutes,
      },
    },
    { upsert: true },
  );
}

export async function listCrons(): Promise<CronRow[]> {
  await connectDB();
  const definitions = getCronDefinitions();
  await Promise.all(definitions.map(ensureSetting));
  const settings = await CronSettingsDB.find({ key: { $in: definitions.map((d) => d.key) } }).lean<
    LeanSetting[]
  >();
  return definitions.flatMap((definition) => {
    const setting = settings.find((s) => s.key === definition.key);
    return setting ? [toCronRow(definition, setting)] : [];
  });
}

/** Pause/resume a cron or change how often it runs. `null` when the key is unknown. */
export async function updateCron(
  key: CronKey,
  patch: { enabled?: boolean; intervalMinutes?: number },
  userId?: string,
): Promise<CronRow | null> {
  await connectDB();
  const definition = getCronDefinitions().find((d) => d.key === key);
  if (!definition) return null;
  await ensureSetting(definition);

  const set: Record<string, unknown> = { updatedByUserId: userId };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.intervalMinutes !== undefined) set.intervalMinutes = patch.intervalMinutes;

  const updated = await CronSettingsDB.findOneAndUpdate(
    { key },
    { $set: set },
    { returnDocument: 'after' },
  ).lean<LeanSetting | null>();
  return updated ? toCronRow(definition, updated) : null;
}

/**
 * Takes the run if the cron is on and due. One atomic conditional update, so two
 * worker replicas ticking together cannot both run it: the loser matches nothing.
 */
async function claimDueCron(definition: CronDefinition, now: Date): Promise<boolean> {
  const claimed = await CronSettingsDB.findOneAndUpdate(
    {
      key: definition.key,
      enabled: true,
      $expr: {
        $lte: [
          { $ifNull: ['$lastRunAt', new Date(0)] },
          { $subtract: [now, { $multiply: ['$intervalMinutes', MINUTE] }] },
        ],
      },
    },
    { $set: { lastRunAt: now } },
  ).lean();
  return Boolean(claimed);
}

/**
 * What a handler reports: the one line the Crons screen shows, and whether the run found nothing to do
 * (`idle`) — an idle run leaves no job behind (see cron-job-records.ts). A plain string means it did work.
 */
export type CronHandlerResult = { summary: string; idle?: boolean };

export type CronHandlers = Record<CronKey, () => Promise<string | CronHandlerResult>>;

export type CronRunOutcome = { key: CronKey; ok: boolean; result?: string; error?: string };

/** Recording is bookkeeping: a failure here is logged and never stops the cron or the tick. */
async function safely<T>(cron: CronKey, what: string, action: () => Promise<T>): Promise<T | null> {
  try {
    return await action();
  } catch (err) {
    logger.error({ err, cron }, `could not ${what}`);
    return null;
  }
}

/** Runs one cron already claimed for this tick, records it on its row and as a job, and says how it went. */
async function runClaimedCron(
  definition: CronDefinition,
  handlers: CronHandlers,
  now: Date,
): Promise<CronRunOutcome> {
  const key = definition.key;
  const startedAt = Date.now();
  const record = await safely(key, 'record the cron run as a job', () =>
    beginCronRunRecord(key, now),
  );
  const close = (end: Parameters<typeof endCronRunRecord>[1]) =>
    record
      ? safely(key, 'close the cron job record', () => endCronRunRecord(record, end))
      : Promise.resolve(null);

  try {
    const outcome = await handlers[key]();
    const result = typeof outcome === 'string' ? outcome : outcome.summary;
    const durationMs = Date.now() - startedAt;
    await CronSettingsDB.updateOne(
      { key },
      { $set: { lastDurationMs: durationMs, lastResult: result }, $unset: { lastError: '' } },
    );
    await close({
      ok: true,
      summary: result,
      idle: typeof outcome === 'string' ? false : Boolean(outcome.idle),
      durationMs,
    });
    return { key, ok: true, result };
  } catch (err) {
    const error = (err instanceof Error ? err.message : 'unknown error').slice(0, 500);
    logger.error({ err, cron: key }, 'cron failed');
    const durationMs = Date.now() - startedAt;
    await CronSettingsDB.updateOne(
      { key },
      { $set: { lastDurationMs: durationMs, lastError: error } },
    );
    await close({ ok: false, error, durationMs });
    return { key, ok: false, error };
  }
}

/**
 * One scheduler tick: runs every cron that is on and due, one after another. A
 * handler that throws is recorded on its row and never stops the others or the
 * tick — and its next attempt waits a full interval, so a failure that persists
 * does not turn into a retry storm.
 */
export async function runDueCrons(
  handlers: CronHandlers,
  now: Date = new Date(),
): Promise<CronRunOutcome[]> {
  await connectDB();
  const outcomes: CronRunOutcome[] = [];

  for (const definition of getCronDefinitions()) {
    await ensureSetting(definition);
    if (!(await claimDueCron(definition, now))) continue;
    outcomes.push(await runClaimedCron(definition, handlers, now));
  }
  return outcomes;
}
