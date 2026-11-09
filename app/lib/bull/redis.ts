import type { RedisOptions } from 'ioredis';
import Redis from 'ioredis';
import { logger } from '../logger';
import { env } from '../env';

const redisConfig: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
};

let redisClientSingleton: Redis | null = null;

export function getRedisClient() {
  if (redisClientSingleton) return redisClientSingleton;

  const client = new Redis(redisConfig);
  // Surface Redis transport errors through the structured logger so they
  // show up in our log pipeline (otherwise ioredis writes to stderr only).
  if (env.NODE_ENV !== 'test') {
    client.on('error', (err) => {
      logger.error({ err }, 'redis client error');
    });
  }

  redisClientSingleton = client;
  return redisClientSingleton;
}

export function getRedisClientIfInitialized(): Redis | null {
  return redisClientSingleton;
}

export { redisConfig };
