// Must be first — populates process.env before any module reads it.
import './load-env';
import * as Sentry from '@sentry/node';

import * as fs from 'node:fs/promises';

import type { Job } from 'bull';

import { runQueuedJob } from '../app/lib/jobs/runner';
import { getJobQueue } from '../app/lib/bull/queue';
import { getRedisClient } from '../app/lib/bull/redis';
import { cronHandlers } from '../app/lib/crons/handlers';
import { runDueCrons } from '../app/lib/services/crons';
import { startQueueDepthSampling } from '../app/lib/bull/queue-stats';
import { logger } from '../app/lib/logger';
import { env } from '../app/lib/env';

const log = logger.child({ component: 'worker' });

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
});

// Safety net: a stray promise rejection from a job processor would kill the worker
// by default in Node 20, leaving Bull jobs stalled. Log and keep the worker alive so
// other concurrent jobs can finish. For sync errors that escape every try/catch the
// process state is suspect — exit and let docker restart give us a clean slate.
process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'unhandled promise rejection');
  Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'uncaught exception');
  Sentry.captureException(err);
  process.exit(1);
});

const heartbeatPath = process.env.APP_WORKER_HEARTBEAT_PATH || '/tmp/worker-heartbeat';
const heartbeatIntervalMs = Number(process.env.APP_WORKER_HEARTBEAT_INTERVAL_MS) || 15000;
const redisClient = getRedisClient();
const jobQueue = getJobQueue();

async function writeHeartbeat() {
  try {
    await redisClient.ping();
    // The file answers the container healthcheck.
    await fs.writeFile(heartbeatPath, String(Date.now()));
  } catch (err) {
    log.error({ err }, 'worker heartbeat failed');
  }
}

// Heartbeat: writes a file every N seconds only if Redis ping succeeds, so the
// docker healthcheck reflects actual liveness instead of just the node process being up.
writeHeartbeat();
const heartbeatTimer = setInterval(writeHeartbeat, heartbeatIntervalMs);

// Queue depth. With no metrics backend, this periodic line is the only way to see
// a backlog building up (or the queue going quiet because nothing is arriving)
// before someone asks why a job is still queued.
const queueStatsTimer = startQueueDepthSampling(
  jobQueue,
  log,
  env.APP_WORKER_QUEUE_STATS_INTERVAL_MS,
);

// Recurring tasks (System > Crons): the SEFAZ resume/poll and the failed-job
// cleanup. One tick a minute; each cron decides from its own stored interval and
// on/off switch whether it is due, so pausing or retuning one needs no restart.
// Safe with several worker replicas — a cron is claimed with an atomic update.
let cronTickRunning = false;
async function cronTick() {
  if (cronTickRunning) return;
  cronTickRunning = true;
  try {
    const outcomes = await runDueCrons(cronHandlers);
    for (const outcome of outcomes) {
      log.info(outcome, outcome.ok ? 'cron ran' : 'cron failed');
    }
  } catch (err) {
    log.error({ err }, 'cron tick failed');
  } finally {
    cronTickRunning = false;
  }
}
// Run once at startup (so a cron never waits a full minute) and then every minute.
cronTick();
const cronTimer = setInterval(cronTick, 60_000);

// Start queue processing
const concurrency = env.APP_BULL_WORKER_CONCURRENCY;
jobQueue.process(concurrency, runQueuedJob);

// Add event listeners
jobQueue.on('failed', (job: Job, err: Error) => {
  const maxAttempts = job.opts?.attempts || 3;
  // Set by the runner for a failure a retry cannot fix (see app/lib/jobs/errors.ts).
  // Bull exposes it as `isDiscarded()` over a private `_discarded` flag and does
  // not declare either, so this reads the accessor defensively rather than a
  // `discarded` property, which does not exist.
  const discarded = (job as unknown as { isDiscarded?: () => boolean }).isDiscarded?.() ?? false;
  const willRetry = !discarded && job.attemptsMade < maxAttempts;
  log.warn(
    {
      jobId: job.id,
      dbJobId: job.data?.jobId,
      attempt: job.attemptsMade,
      maxAttempts,
      willRetry,
      err: err.message,
    },
    'job failed',
  );
  Sentry.captureException(err, {
    extra: {
      jobId: job.id,
      dbJobId: job.data?.jobId,
      attempt: job.attemptsMade,
      maxAttempts,
      willRetry,
    },
  });
});

// Bull re-queues a stalled job silently. Stalling means the worker lost the job's
// lock — event-loop starvation, an OOM kill, or a container restart mid-job — and
// it is also how the same job could run twice, so it must leave a trace.
jobQueue.on('stalled', (job: Job) => {
  log.warn({ jobId: job.id, dbJobId: job.data?.jobId }, 'job stalled — bull will re-queue it');
});

jobQueue.on('error', (err: Error) => {
  log.error({ err: err.message }, 'redis error');
  Sentry.captureException(err);
});

async function shutdown(signal: string) {
  log.info({ signal }, 'worker shutting down');
  clearInterval(heartbeatTimer);
  clearInterval(cronTimer);
  if (queueStatsTimer) clearInterval(queueStatsTimer);
  await fs.unlink(heartbeatPath).catch(() => undefined);
  await jobQueue.close();
  await Sentry.close(2000);
  log.info('worker queue closed');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info({ concurrency }, 'bull worker started');
