import {
  BASELINE_RATES,
  DEFAULT_PIPELINE_SHAPE,
  elapsedMs,
  forecastRun,
  phaseBreakdown,
  projectStudy,
  ratesFromJob,
  synthesisCallSlots,
  type PipelineRates,
} from '@/app/lib/jobs/estimate';
import { formatDuration } from '@/app/lib/duration-format';

const NOW = new Date('2026-08-28T12:00:00Z').getTime();
const SHAPE = { batchSize: 20, leafConcurrency: 4, synthesisFanout: 5 };
const RATES: PipelineRates = {
  msPerImage: 100,
  msPerBatch: 60_000,
  msPerSynthesisNode: 30_000,
  source: 'measured',
};

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe('phase breakdown', () => {
  it('measures a closed phase and leaves the running one open against now', () => {
    const { phases, accountedMs } = phaseBreakdown(
      {
        startedAt: at(-600_000),
        converting: { startedAt: at(-600_000), endedAt: at(-540_000) },
        analyzing: { startedAt: at(-540_000) },
      },
      'running',
      NOW,
    );

    expect(phases[0]).toMatchObject({ phase: 'converting', ms: 60_000, running: false });
    expect(phases[1]).toMatchObject({ phase: 'analyzing', ms: 540_000, running: true });
    expect(phases[2]?.ms).toBeUndefined();
    expect(accountedMs).toBe(600_000);
  });

  it('does not let a phase left open by a dead job grow forever', () => {
    const { phases } = phaseBreakdown(
      { startedAt: at(-86_400_000), analyzing: { startedAt: at(-86_400_000) } },
      'failed',
      NOW,
    );
    expect(phases[1]?.ms).toBeUndefined();
  });

  it('flags a phase timed by an earlier attempt and keeps it out of the shares', () => {
    // A retry that reused the converted study: conversion is stamped before this
    // run even started.
    const { phases, accountedMs } = phaseBreakdown(
      {
        startedAt: at(-120_000),
        converting: { startedAt: at(-900_000), endedAt: at(-840_000) },
        analyzing: { startedAt: at(-120_000), endedAt: at(-60_000) },
      },
      'done',
      NOW,
    );

    expect(phases[0]?.fromPreviousRun).toBe(true);
    expect(phases[0]?.share).toBeUndefined();
    expect(phases[1]?.share).toBe(1);
    expect(accountedMs).toBe(60_000);
  });
});

describe('elapsed time', () => {
  it('counts from when the worker picked the job, not from when it was queued', () => {
    expect(
      elapsedMs(
        {
          status: 'running',
          createdAt: at(-3_600_000),
          timings: { startedAt: at(-300_000) },
        },
        NOW,
      ),
    ).toBe(300_000);
  });

  it('falls back to the document timestamps for jobs recorded before timings existed', () => {
    expect(
      elapsedMs({ status: 'done', createdAt: at(-600_000), updatedAt: at(-300_000) }, NOW),
    ).toBe(300_000);
  });
});

describe('synthesis tree', () => {
  it('folds partials by fanout, running the level at the configured concurrency', () => {
    // 100 batches → 20 nodes (5 slots at 4-way) → 4 nodes (1 slot) → 1 (1 slot).
    expect(synthesisCallSlots(100, SHAPE)).toBe(7);
    // A single batch still costs one pass to become a laudo.
    expect(synthesisCallSlots(1, SHAPE)).toBe(1);
  });
});

describe('projecting a bigger study', () => {
  it('models conversion as sequential and the leaves as concurrent', () => {
    const projection = projectStudy(5_000, SHAPE, RATES);
    expect(projection.batches).toBe(250);
    expect(projection.conversionMs).toBe(500_000);
    // 250 batches, 4 at a time → 63 rounds of one call each.
    expect(projection.analysisMs).toBe(63 * 60_000);
    expect(projection.totalMs).toBe(
      projection.conversionMs + projection.analysisMs + projection.synthesisMs,
    );
  });

  it('shrinks the analysis when concurrency goes up, and never the conversion', () => {
    const slow = projectStudy(5_000, { ...SHAPE, leafConcurrency: 1 }, RATES);
    const fast = projectStudy(5_000, { ...SHAPE, leafConcurrency: 8 }, RATES);
    expect(fast.analysisMs).toBeLessThan(slow.analysisMs);
    expect(fast.conversionMs).toBe(slow.conversionMs);
  });

  it('handles an empty study without dividing by anything', () => {
    expect(projectStudy(0, SHAPE, RATES)).toMatchObject({ batches: 0, totalMs: 0 });
  });
});

describe('run forecast', () => {
  const base = {
    shape: SHAPE,
    rates: RATES,
    createdAt: at(-600_000),
  };

  it('reports conversion of an unknown-sized study as indeterminate', () => {
    const forecast = forecastRun(
      {
        ...base,
        status: 'running',
        progress: {
          phase: 'converting',
          convertedFiles: 120,
          timings: { startedAt: at(-60_000), converting: { startedAt: at(-60_000) } },
        },
      },
      NOW,
    );
    expect(forecast.indeterminate).toBe(true);
    expect(forecast.percent).toBeUndefined();
  });

  it('extrapolates the remaining batches from the pace this run actually held', () => {
    const forecast = forecastRun(
      {
        ...base,
        status: 'running',
        progress: {
          phase: 'analyzing',
          conversionComplete: true,
          instanceCount: 400,
          batchesTotal: 20,
          batchesDone: 5,
          timings: {
            startedAt: at(-640_000),
            converting: { startedAt: at(-640_000), endedAt: at(-600_000) },
            analyzing: { startedAt: at(-600_000) },
          },
        },
      },
      NOW,
    );

    // 5 batches in 10 minutes → 2 min each → 15 batches left ≈ 30 minutes.
    expect(forecast.remainingMs).toBeGreaterThan(29 * 60_000);
    expect(forecast.percent).toBeGreaterThan(0);
    expect(forecast.percent).toBeLessThan(99);
  });

  it('never reports a running job as finished', () => {
    const forecast = forecastRun(
      {
        ...base,
        status: 'running',
        progress: {
          phase: 'synthesizing',
          conversionComplete: true,
          instanceCount: 400,
          batchesTotal: 20,
          batchesDone: 20,
          timings: {
            startedAt: at(-640_000),
            converting: { startedAt: at(-640_000), endedAt: at(-600_000) },
            analyzing: { startedAt: at(-600_000), endedAt: at(-60_000) },
            synthesizing: { startedAt: at(-60_000) },
          },
        },
      },
      NOW,
    );
    expect(forecast.percent).toBeLessThanOrEqual(99);
  });

  it('is complete for a finished job', () => {
    expect(forecastRun({ ...base, status: 'done', progress: {} }, NOW)).toMatchObject({
      percent: 100,
      remainingMs: 0,
    });
  });
});

describe('rates taken from a job', () => {
  it('prefers the job’s own measurements and says so', () => {
    const rates = ratesFromJob(
      { msPerImage: 96, msPerBatch: 71_000, synthesisMs: 60_000, batchesTotal: 20 },
      SHAPE,
    );
    expect(rates.msPerImage).toBe(96);
    expect(rates.msPerBatch).toBe(71_000);
    expect(rates.source).toBe('measured');
  });

  it('falls back to the baseline when the job measured nothing', () => {
    const rates = ratesFromJob(undefined, DEFAULT_PIPELINE_SHAPE);
    expect(rates).toMatchObject({
      msPerImage: BASELINE_RATES.msPerImage,
      msPerBatch: BASELINE_RATES.msPerBatch,
      source: 'baseline',
    });
  });

  it('marks a partially measured job as mixed rather than measured', () => {
    expect(ratesFromJob({ msPerImage: 96 }, SHAPE).source).toBe('mixed');
  });
});

describe('duration formatting', () => {
  it.each([
    [undefined, '—'],
    [108, '108 ms'],
    [2_400, '2.4 s'],
    [45_000, '45 s'],
    [5 * 60_000 + 20_000, '5 min 20 s'],
    [26 * 60_000, '26 min'],
    [5_820_000, '1 h 37 min'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
