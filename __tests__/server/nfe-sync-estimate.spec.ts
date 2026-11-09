/**
 * @jest-environment node
 */
export {};

import { nfeSyncForecast } from '@/app/lib/jobs/nfe-sync-estimate';

const START = new Date('2026-09-24T12:00:00.000Z');
const at = (seconds: number) => START.getTime() + seconds * 1000;

describe('nfeSyncForecast', () => {
  it('is indeterminate while there is no denominator yet (still fetching)', () => {
    const forecast = nfeSyncForecast({
      status: 'running',
      progress: { phase: 'fetching' },
      startedAt: START,
      now: at(3),
    });
    expect(forecast).toMatchObject({ indeterminate: true, percent: 0, elapsedMs: 3000 });
    expect(forecast.remainingMs).toBeUndefined();
  });

  it('has a percent but no ETA before the first document is processed', () => {
    const forecast = nfeSyncForecast({
      status: 'running',
      progress: { phase: 'processing', docsTotal: 50, docsDone: 0 },
      startedAt: START,
      now: at(2),
    });
    expect(forecast).toMatchObject({ indeterminate: false, percent: 0 });
    expect(forecast.remainingMs).toBeUndefined();
  });

  it('projects the time left from the measured rate', () => {
    const forecast = nfeSyncForecast({
      status: 'running',
      progress: { phase: 'processing', docsTotal: 50, docsDone: 10 },
      startedAt: START,
      now: at(20), // 20s for 10 docs -> 2s/doc -> 40 left = 80s
    });
    expect(forecast.percent).toBe(20);
    expect(forecast.remainingMs).toBe(80_000);
  });

  it('never reports 100% until the job is actually done', () => {
    const running = nfeSyncForecast({
      status: 'running',
      progress: { docsTotal: 50, docsDone: 50 },
      startedAt: START,
      now: at(60),
    });
    expect(running.percent).toBe(99);
    expect(nfeSyncForecast({ status: 'done', startedAt: START, now: at(60) })).toMatchObject({
      percent: 100,
      remainingMs: 0,
    });
  });
});
