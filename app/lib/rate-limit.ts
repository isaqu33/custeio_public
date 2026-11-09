import { getRedisClient } from './bull/redis';
import { logger } from './logger';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// Fixed-window rate limit per (scope, ip), backed by rate-limiter-flexible + Redis.
// Returns: true = blocked, false = allowed.
// Fail-open by default: if Redis is unreachable, requests pass through.
// Operators must monitor 'rate-limit redis error' logs to detect Redis outages.
const limiterCache = new Map<string, RateLimiterRedis>();
// A hung Redis must not hang the request. Without this bound `consume()` waits on
// the driver's own (much longer) timeout and the fail-open below never happens —
// the caller just stalls.
const RATE_LIMIT_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`rate-limit timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function getLimiter(scope: string, limit: number): RateLimiterRedis {
  const key = `${scope}:${limit}`;
  const cached = limiterCache.get(key);
  if (cached) return cached;

  const limiter = new RateLimiterRedis({
    storeClient: getRedisClient(),
    keyPrefix: `rate:${scope}`,
    points: limit,
    duration: 60,
  });

  limiterCache.set(key, limiter);
  return limiter;
}

export async function rateLimit(scope: string, ip: string, limit: number): Promise<boolean> {
  try {
    const limiter = getLimiter(scope, limit);
    await withTimeout(limiter.consume(ip || 'unknown'), RATE_LIMIT_TIMEOUT_MS);
    return false; // allowed
  } catch (err) {
    // Rejected by the limiter (quota exceeded)
    if (err && typeof err === 'object' && 'remainingPoints' in err) {
      return true;
    }
    logger.error({ err, scope, ip }, 'rate-limit redis error, allowing request');
    return false; // fail open — see comment above
  }
}
