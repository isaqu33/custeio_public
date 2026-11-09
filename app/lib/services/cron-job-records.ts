import connectDB from '@/app/lib/connect-db';
import type { CronKey } from '@/app/lib/crons/definitions';
import JobsDB from '@/app/models/jobs';

// A cron is not a queued job, but what it does in the background has to be as visible as what a
// queued job does: Sistema > Jobs is where everything that happens behind the screens is read. Each
// run of a cron is therefore recorded as a job of kind `cron.<key>` — platform-level (no
// organization), System/Support only (jobs/system-only-kinds.ts).
//
// Worker-safe (models and plain helpers only): the worker's scheduler calls this.

export type CronRunRecord = { id: string; startedAt: Date };

export const cronJobKind = (key: CronKey) => `cron.${key}`;

/** Opens the run as a `running` job, so a long one is visible while it is happening. */
export async function beginCronRunRecord(key: CronKey, now: Date): Promise<CronRunRecord> {
  await connectDB();
  const kind = cronJobKind(key);
  const job = await JobsDB.create({
    kind,
    handler: kind,
    type: 'Cron',
    examId: `CRON-${key}-${now.getTime()}`,
    status: 'running',
    payload: { cron: key },
    queue: { provider: 'scheduler', queueName: 'crons' },
    logs: [
      { jobStatus: 'running', step: 'cron-start', message: `Cron ${key} started.`, timestamp: now },
    ],
  });
  return { id: String(job._id), startedAt: now };
}

export type CronRunEnd =
  | { ok: true; summary: string; idle: boolean; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * Closes the run. A run that succeeded and found nothing to do (`idle`) leaves no trace: a cron that
 * ticks every few minutes would otherwise bury the jobs that matter under rows saying "0 started" —
 * the Crons screen still shows its last result. Everything else (work done, or a failure) stays.
 */
export async function endCronRunRecord(record: CronRunRecord, end: CronRunEnd): Promise<void> {
  await connectDB();
  if (end.ok && end.idle) {
    await JobsDB.deleteOne({ _id: record.id });
    return;
  }
  await JobsDB.updateOne(
    { _id: record.id },
    {
      $set: {
        status: end.ok ? 'done' : 'failed',
        result: end.ok
          ? { summary: end.summary, durationMs: end.durationMs }
          : { error: end.error, durationMs: end.durationMs },
        ...(end.ok ? {} : { errorLogs: [{ message: end.error, timestamp: new Date() }] }),
      },
      $push: {
        logs: {
          jobStatus: end.ok ? 'done' : 'failed',
          step: 'cron-end',
          message: end.ok ? end.summary : end.error,
          timestamp: new Date(),
        },
      },
    },
  );
}

/** Drops the records of cron runs older than `days`, so the history stays bounded. */
export async function purgeOldCronRunRecords(
  days: number,
  now: Date = new Date(),
): Promise<number> {
  await connectDB();
  const result = await JobsDB.deleteMany({
    kind: { $regex: '^cron\\.' },
    createdAt: { $lt: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) },
  });
  return result.deletedCount ?? 0;
}
