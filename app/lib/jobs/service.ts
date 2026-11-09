import mongoose from 'mongoose';
import connectDB from '../connect-db';
import { enqueueJobById } from '../bull/queue';
import JobsDB from '@/app/models/jobs';
import type { JobConfig, JobKind, JobPayloadByKind } from './types';
import type { Logger } from 'pino';
import { logger } from '../logger';
import { env } from '../env';

export async function createAndEnqueueJob<K extends JobKind>(
  {
    kind,
    payload,
    organizationId,
    reference,
    config,
    type,
  }: {
    kind: K;
    payload: JobPayloadByKind[K];
    organizationId: string;
    reference: string;
    config?: JobConfig;
    type?: string;
  },
  log: Logger = logger,
) {
  await connectDB();

  const jobDoc = await JobsDB.findOneAndUpdate(
    { reference, organizationId: new mongoose.Types.ObjectId(organizationId) },
    {
      $set: {
        kind,
        handler: kind,
        payload,
        // The retry policy is frozen onto the job at creation, because the retry
        // action re-enqueues from this stored copy. It has to come from the env
        // knobs: these were hardcoded to 3 attempts / 5s, which is shorter than
        // the AI circuit breaker's own 60s cooldown — once the breaker opened,
        // every remaining attempt was spent being told the circuit was open, and
        // the study failed while the provider was already recovering.
        config: config ?? {
          attempts: env.APP_BULL_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: env.APP_BULL_BACKOFF_DELAY_MS },
          removeOnComplete: true,
          removeOnFail: env.APP_BULL_KEEP_FAILED_JOBS,
        },
        status: 'queued',
        type: type ?? 'Gateway',
      },
      $setOnInsert: {
        reference,
        organizationId: new mongoose.Types.ObjectId(organizationId),
        params: { payloadOriginal: payload },
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  const queueJob = await enqueueJobById({ jobId: String(jobDoc._id) }, config, log);

  await JobsDB.updateOne(
    { _id: jobDoc._id },
    {
      $set: {
        'queue.provider': 'bull',
        'queue.queueName': 'custeio-jobs',
        'queue.queueJobId': String(queueJob.id),
      },
    },
  );

  return { dbJobId: String(jobDoc._id), queueJobId: String(queueJob.id) };
}
