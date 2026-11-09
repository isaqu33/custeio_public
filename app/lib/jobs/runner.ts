import type { Job } from 'bull';
import connectDB from '../connect-db';
import JobsDB from '@/app/models/jobs';
import { jobRegistry } from '@/app/jobs/registry';
import { logger } from '../logger';
import { PermanentJobError } from './errors';
import type { JobKind } from './types';
import { jobPayloadSchemas } from './schemas';

type QueueBackedJob = {
  _id: string;
  kind?: JobKind;
  payload?: unknown;
  status?: string;
  config?: { attempts?: number };
};

export async function runQueuedJob(job: Job<{ jobId: string }>) {
  const dbJobId = job.data?.jobId;
  if (!dbJobId) {
    throw new Error('Missing db job id in queue payload.');
  }

  await connectDB();

  const dbJob = await JobsDB.findById(dbJobId).lean<QueueBackedJob | null>();
  if (!dbJob) {
    throw new Error(`Job ${dbJobId} not found.`);
  }

  const kind = dbJob.kind;

  await JobsDB.updateOne(
    { _id: dbJobId },
    {
      $set: {
        status: 'running',
        'queue.queueJobId': String(job.id),
        // Clock of THIS run. Set on every attempt, so a retried job times the
        // attempt the reader is looking at rather than the first one — and the
        // queue wait (createdAt → here) stays outside the pipeline's time.
        'progress.timings.startedAt': new Date(),
      },
      $unset: { 'progress.timings.finishedAt': '' },
      $push: {
        logs: {
          jobStatus: 'running',
          message: `Worker assumiu o job (tipo=${kind})`,
          timestamp: new Date(),
          step: 'worker-fetch',
        },
      },
    },
  );

  const maxAttempts = job.opts?.attempts || dbJob.config?.attempts || 3;

  try {
    // Inside the try on purpose: a worker that does not know this kind (an old
    // process still running after a deploy added one) must leave the failure ON
    // the job. Thrown before this block, the job stayed "queued" with no trace
    // while Bull retried, and once the attempts ran out it stayed "queued"
    // forever — which also blocked its own enqueue routes with "already running".
    // It is not permanent: a retry can land on an up-to-date worker.
    if (!kind || !jobRegistry[kind]) {
      throw new Error(
        `Nenhum handler registrado para o tipo "${kind ?? 'indefinido'}" — o worker pode estar desatualizado; reinicie-o.`,
      );
    }

    const executionContext = {
      jobId: String(dbJob._id),
      bullJobId: job.id,
      attempt: job.attemptsMade + 1,
      maxAttempts,
    };

    // Table-driven so registering a handler is enough to make a kind runnable.
    // The cast is the one place where the per-kind payload types collapse: the
    // schema keyed by `kind` produced this payload, and the handler keyed by the
    // same `kind` consumes it, but TypeScript cannot follow the pair through the
    // index. Both tables are keyed by `JobKind`, so a missing entry is a compile
    // error rather than a runtime one.
    const payload = jobPayloadSchemas[kind].parse(dbJob.payload);
    const handler = jobRegistry[kind] as (
      _payload: unknown,
      _context: typeof executionContext,
    ) => Promise<Record<string, unknown> | void>;
    const result = await handler(payload, executionContext);

    await JobsDB.updateOne(
      { _id: dbJobId },
      {
        $set: {
          status: 'done',
          'progress.timings.finishedAt': new Date(),
          ...(result ? { result } : {}),
        },
      },
    );

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    // A permanent failure (a rejected AI model, an unusable payload) fails the
    // same way on every attempt. Discarding stops Bull from re-running it and
    // stacking identical errors on the job; the support retry action enqueues a
    // fresh job and is unaffected.
    const permanent = err instanceof PermanentJobError;
    const failureCode = permanent ? err.code : undefined;
    if (permanent) {
      // `discard()` is SYNCHRONOUS in Bull v4 — it flips `_discarded` on the job
      // and returns undefined — even though @types/bull declares it as
      // `Promise<void>`. Awaiting it (or chaining `.catch`) throws a TypeError
      // from inside this catch block, which replaces the real failure AND skips
      // the status update below, leaving the job stuck as "running". Hence the
      // cast, and the try/catch instead of a promise chain.
      try {
        (job as unknown as { discard?: () => void }).discard?.();
      } catch (discardErr) {
        logger.warn({ err: discardErr, dbJobId }, 'could not discard a permanently failed job');
      }
    }
    await JobsDB.updateOne(
      { _id: dbJobId },
      {
        $set: { status: 'failed', 'progress.timings.finishedAt': new Date() },
        $push: {
          errorLogs: {
            message: errorMessage,
            ...(failureCode ? { code: failureCode } : {}),
            attempt: job.attemptsMade + 1,
            timestamp: new Date(),
          },
        },
      },
    );
    logger.error({ err, dbJobId, queueJobId: job.id, permanent }, 'queued job execution failed');
    throw err;
  }
}
