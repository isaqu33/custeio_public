import type { Logger } from 'pino';

// Queue depth is the only backlog signal the system has (there is no metrics
// backend yet), so it is sampled into the log on an interval and read back from
// there. Kept out of `scripts/worker.ts` so the failure handling below can be
// tested: sampling runs forever inside a long-lived process, and a Redis hiccup
// while reading counts must never be the thing that takes the worker down.

// `object`, not bull's `JobCounts`: the shape is only ever forwarded to the
// logger, and a structural type keeps the queue (and Redis) out of the tests.
type CountsSource = { getJobCounts: () => Promise<object> };

export async function logQueueDepth(queue: CountsSource, log: Logger): Promise<void> {
  try {
    const counts = await queue.getJobCounts();
    log.info(counts, 'queue depth');
  } catch (err) {
    log.error({ err }, 'queue depth sampling failed');
  }
}

/**
 * Starts periodic sampling and takes the first sample immediately, so a worker
 * that boots into an existing backlog says so in its first seconds instead of
 * after a full interval. Returns the timer to clear on shutdown, or `undefined`
 * when sampling is disabled (`intervalMs` of 0).
 */
export function startQueueDepthSampling(
  queue: CountsSource,
  log: Logger,
  intervalMs: number,
): NodeJS.Timeout | undefined {
  if (intervalMs <= 0) return undefined;
  void logQueueDepth(queue, log);
  return setInterval(() => void logQueueDepth(queue, log), intervalMs);
}
