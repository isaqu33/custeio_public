import mongoose from 'mongoose';
import connectDB from '@/app/lib/connect-db';
import { getRedisClient } from '@/app/lib/bull/redis';
import { env } from '@/app/lib/env';

const PING_TIMEOUT_MS = env.APP_HEALTHCHECK_PING_TIMEOUT_MS;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} ping timed out after ${ms}ms`));
    }, ms);

    promise
      .then((result) => resolve(result))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

async function pingMongo(): Promise<void> {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('mongo connection has no db handle');
  await db.admin().ping();
}

export async function checkReadiness() {
  const startedAt = Date.now();
  const redisClient = getRedisClient();

  const [mongoRes, redisRes] = await Promise.allSettled([
    withTimeout(pingMongo(), PING_TIMEOUT_MS, 'mongo'),
    withTimeout(
      redisClient.ping().then(() => undefined),
      PING_TIMEOUT_MS,
      'redis',
    ),
  ]);

  const mongoOk = mongoRes.status === 'fulfilled';
  const redisOk = redisRes.status === 'fulfilled';
  const allOk = mongoOk && redisOk;

  const body: Record<string, unknown> = {
    status: allOk ? 'ok' : 'fail',
    checks: {
      mongo: mongoOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
    },
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  if (!allOk) {
    const errors: Record<string, string> = {};
    if (!mongoOk)
      errors.mongo =
        (mongoRes as PromiseRejectedResult).reason?.message ??
        String((mongoRes as PromiseRejectedResult).reason);
    if (!redisOk)
      errors.redis =
        (redisRes as PromiseRejectedResult).reason?.message ??
        String((redisRes as PromiseRejectedResult).reason);
    body.errors = errors;
  }

  return { body, statusCode: allOk ? 200 : 503 };
}
