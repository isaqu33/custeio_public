/**
 * @jest-environment node
 */
export {};

import fs from 'fs';
import path from 'path';
import type { Logger } from 'pino';
import { logQueueDepth, startQueueDepthSampling } from '@/app/lib/bull/queue-stats';

function fakeLogger() {
  const info = jest.fn();
  const error = jest.fn();
  return { logger: { info, error } as unknown as Logger, info, error };
}

describe('queue depth sampling', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('logs the counts it reads from the queue', async () => {
    const { logger, info } = fakeLogger();
    const counts = { waiting: 12, active: 3, failed: 1 };

    await logQueueDepth({ getJobCounts: async () => counts }, logger);

    expect(info).toHaveBeenCalledWith(counts, 'queue depth');
  });

  it('swallows a failing sample so a Redis hiccup cannot kill the worker', async () => {
    const { logger, error, info } = fakeLogger();

    await expect(
      logQueueDepth(
        {
          getJobCounts: async () => {
            throw new Error('redis down');
          },
        },
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('samples immediately and then on the interval', async () => {
    jest.useFakeTimers();
    const { logger, info } = fakeLogger();
    const getJobCounts = jest.fn(async () => ({ waiting: 0 }));

    const timer = startQueueDepthSampling({ getJobCounts }, logger, 60_000);

    // The boot sample: a worker starting into an existing backlog must say so
    // straight away, not one interval later.
    await jest.advanceTimersByTimeAsync(0);
    expect(getJobCounts).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(120_000);
    expect(getJobCounts).toHaveBeenCalledTimes(3);
    expect(info).toHaveBeenCalledTimes(3);

    if (timer) clearInterval(timer);
  });

  it('stays off when the interval is zero', async () => {
    jest.useFakeTimers();
    const { logger, info } = fakeLogger();
    const getJobCounts = jest.fn(async () => ({ waiting: 0 }));

    const timer = startQueueDepthSampling({ getJobCounts }, logger, 0);

    await jest.advanceTimersByTimeAsync(600_000);
    expect(timer).toBeUndefined();
    expect(getJobCounts).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});

// `scripts/worker.ts` runs as a standalone process and cannot be imported here
// (it opens Redis and starts consuming on load), so its wiring is pinned by
// reading it. Both signals below are the kind that fail silently when dropped:
// nothing errors, the log just goes quiet.
describe('worker observability wiring', () => {
  const worker = fs.readFileSync(path.join(process.cwd(), 'scripts', 'worker.ts'), 'utf8');

  it('samples queue depth and clears the timer on shutdown', () => {
    expect(worker).toContain('startQueueDepthSampling(');
    expect(worker).toContain('APP_WORKER_QUEUE_STATS_INTERVAL_MS');
    expect(worker).toMatch(/clearInterval\(queueStatsTimer\)/);
  });

  it('logs stalled jobs, which bull otherwise re-queues silently', () => {
    // A stalled job is how the same study gets analyzed twice; without this
    // listener there is no trace of it happening.
    expect(worker).toMatch(/jobQueue\.on\('stalled'/);
  });
});
