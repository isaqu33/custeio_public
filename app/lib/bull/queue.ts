import Bull, { type QueueOptions } from 'bull';
import type { Logger } from 'pino';
import { logger } from '../logger';
import type { JobConfig } from '../jobs/types';
import { redisConfig } from './redis';
import { env } from '../env';

export interface QueueJobData {
  jobId: string;
}

let jobQueueSingleton: Bull.Queue<QueueJobData> | null = null;

export function getJobQueue() {
  if (jobQueueSingleton) return jobQueueSingleton;

  // The single Bull queue every Custeio job goes through.
  const queue = new Bull<QueueJobData>('custeio-jobs', {
    // Cast because bull ^4 pins ioredis ^5 and resolves it to its own nested copy,
    // so the RedisOptions we build against ioredis 6 is a structurally different
    // type. Only the types differ — bull connects with its bundled client either
    // way, and the fields below exist in both.
    redis: {
      ...redisConfig,
      family: 4,
      maxRetriesPerRequest: null,
    } as QueueOptions['redis'],
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: env.APP_BULL_KEEP_FAILED_JOBS,
      attempts: env.APP_BULL_JOB_ATTEMPTS,
      backoff: {
        // 15s → 30s → 1m → 2m → 4m: the retry window has to outlast a provider
        // blip, not just a dropped socket. Re-running an analysis is cheap —
        // conversion-skip and the leaf checkpoint make a retry resume rather
        // than re-spend — so the cost of waiting it out is far below the cost
        // of failing a study the provider could have served a minute later.
        type: 'exponential',
        delay: env.APP_BULL_BACKOFF_DELAY_MS,
      },
    },
  });

  queue.on('error', (error) => {
    logger.error({ err: error.message }, 'bull queue connection error');
  });

  jobQueueSingleton = queue;
  return jobQueueSingleton;
}

export async function enqueueJobById(data: QueueJobData, config?: JobConfig, log: Logger = logger) {
  const queue = getJobQueue();
  const job = await queue.add(data, {
    attempts: config?.attempts ?? env.APP_BULL_JOB_ATTEMPTS,
    backoff: {
      type: config?.backoff?.type ?? 'exponential',
      delay: config?.backoff?.delay ?? env.APP_BULL_BACKOFF_DELAY_MS,
    },
    removeOnComplete: config?.removeOnComplete ?? true,
    removeOnFail: config?.removeOnFail ?? env.APP_BULL_KEEP_FAILED_JOBS,
  });
  log.info(
    {
      jobId: job.id,
      dbJobId: data.jobId,
    },
    'job enqueued',
  );
  return job;
}
