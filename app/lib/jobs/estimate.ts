// Time model of an analysis job: how long each phase took, how far the job is,
// how long is left, and what a study of N images would cost in wall-clock.
//
// Pure and side-effect free on purpose — the worker writes timestamps, the
// service reads measurements out of Mongo, and every derived number (duration,
// percentage, ETA, projection) is computed here so the modal and the tests agree
// on one model instead of each re-deriving it.

import type { JobPhaseSpan, JobProgress, JobStatus, JobTimings } from '@/app/lib/types/jobs';

/** Wall-clock rates the projection multiplies out. All values in milliseconds. */
export type PipelineRates = {
  /** DICOM → JPEG for one file. Conversion is strictly sequential in the worker. */
  msPerImage: number;
  /** One AI call for one image batch (per-call latency, NOT wall clock). */
  msPerBatch: number;
  /** One node of the synthesis tree-reduce (a text-only AI call). */
  msPerSynthesisNode: number;
  /** Where these numbers came from, so the UI never passes a guess off as a measurement. */
  source: 'measured' | 'mixed' | 'baseline';
};

/**
 * Fallback rates for a job that has not measured anything yet.
 *
 * `msPerImage` is measured: `dcm2img +Jq 90 +Sxv 1024` over a 2194×2550 radiograph,
 * 10 runs, on the dev machine. `msPerBatch` is an estimate extrapolated from a
 * single 1-image batch — it is the weakest number here, which is exactly why a
 * projection built on it is labelled `baseline` and one built on a real run is
 * labelled `measured`.
 */
export const BASELINE_RATES: PipelineRates = {
  msPerImage: 108,
  msPerBatch: 75_000,
  msPerSynthesisNode: 75_000,
  source: 'baseline',
};

/** Runtime knobs that shape the pipeline (the `APP_AI_*` env values). */
export type PipelineShape = {
  batchSize: number;
  leafConcurrency: number;
  synthesisFanout: number;
};

/**
 * Fallback shape for a job whose measurements were not loaded (a non-analysis
 * job, or an older document). Mirrors the `APP_AI_*` defaults in `env.ts`.
 */
export const DEFAULT_PIPELINE_SHAPE: PipelineShape = {
  batchSize: 20,
  leafConcurrency: 4,
  synthesisFanout: 5,
};

export const PHASE_KEYS = ['converting', 'analyzing', 'synthesizing'] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

function time(value?: string | Date | null): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Duration of one phase span. An open span (started, never ended) is measured
 * against `now` only while the job is still alive — for a job that died mid-phase
 * the span would otherwise grow forever, reporting "conversion: 6 days".
 */
export function spanMs(
  span: JobPhaseSpan | undefined,
  now: number,
  live: boolean,
): number | undefined {
  const startedAt = time(span?.startedAt);
  if (startedAt === undefined) return undefined;
  const endedAt = time(span?.endedAt);
  if (endedAt !== undefined) return Math.max(0, endedAt - startedAt);
  if (!live) return undefined;
  return Math.max(0, now - startedAt);
}

export function isRunning(status: JobStatus): boolean {
  return status === 'running' || status === 'queued';
}

export type PhaseBreakdown = {
  phase: PhaseKey;
  ms?: number;
  /** Share of the accounted time, 0..1. Undefined while nothing is measured yet. */
  share?: number;
  running: boolean;
  /**
   * The phase was timed by an EARLIER attempt and skipped by this one — which is
   * exactly what a retry that reuses the converted study looks like. Its duration
   * is still worth showing (it is how long that work took) but it is not part of
   * this run's clock, so it is kept out of the shares.
   */
  fromPreviousRun: boolean;
};

/**
 * Per-phase durations plus each one's share of the total — the answer to "where
 * did the time go", which is the question a 40-minute job actually raises.
 */
export function phaseBreakdown(
  timings: JobTimings | undefined,
  status: JobStatus,
  now: number,
): { phases: PhaseBreakdown[]; accountedMs: number } {
  const live = isRunning(status);
  const runStartedAt = time(timings?.startedAt);
  const phases = PHASE_KEYS.map((phase) => {
    const span = timings?.[phase];
    const ms = spanMs(span, now, live);
    const startedAt = time(span?.startedAt);
    return {
      phase,
      ms,
      running: Boolean(span?.startedAt) && !span?.endedAt && live,
      fromPreviousRun:
        runStartedAt !== undefined && startedAt !== undefined && startedAt < runStartedAt,
    } satisfies PhaseBreakdown;
  });
  const accountedMs = phases.reduce(
    (sum, entry) => sum + (entry.fromPreviousRun ? 0 : (entry.ms ?? 0)),
    0,
  );
  return {
    phases: phases.map((entry) => ({
      ...entry,
      share:
        accountedMs > 0 && entry.ms !== undefined && !entry.fromPreviousRun
          ? entry.ms / accountedMs
          : undefined,
    })),
    accountedMs,
  };
}

/**
 * Total wall-clock of the run: from the moment the worker picked the job to the
 * moment it stopped. Falls back to the queue timestamps for jobs created before
 * the timings existed, so old jobs still show something rather than a dash.
 */
export function elapsedMs(
  input: {
    status: JobStatus;
    createdAt?: string | Date;
    updatedAt?: string | Date;
    timings?: JobTimings;
  },
  now: number,
): number | undefined {
  const startedAt = time(input.timings?.startedAt) ?? time(input.createdAt);
  if (startedAt === undefined) return undefined;
  const finishedAt =
    time(input.timings?.finishedAt) ??
    (isRunning(input.status) ? undefined : time(input.updatedAt));
  return Math.max(0, (finishedAt ?? now) - startedAt);
}

/**
 * Number of sequential AI call-slots the tree-reduce needs: each level folds
 * `fanout` partials into one, and the nodes of a level run `leafConcurrency` at a
 * time. Used both to project a synthesis and to back out a per-node rate from a
 * measured one.
 */
export function synthesisCallSlots(batches: number, shape: PipelineShape): number {
  const fanout = Math.max(2, shape.synthesisFanout);
  const concurrency = Math.max(1, shape.leafConcurrency);
  let nodes = Math.max(1, batches);
  let slots = 0;
  while (nodes > 1) {
    nodes = Math.ceil(nodes / fanout);
    slots += Math.ceil(nodes / concurrency);
  }
  // A single batch still gets one synthesis pass to turn the partial into a laudo.
  return Math.max(1, slots);
}

export type Projection = {
  images: number;
  batches: number;
  conversionMs: number;
  analysisMs: number;
  synthesisMs: number;
  totalMs: number;
};

/**
 * What a study of `images` images would take on the current configuration.
 *
 * Conversion is sequential (the zip is walked one entry at a time, on purpose —
 * bounded memory), the leaf calls run `leafConcurrency` at a time, and synthesis
 * is a tree. `batches` is a FLOOR: batches never cross a DICOM series, so a study
 * with many short series produces more of them than `images / batchSize`.
 */
export function projectStudy(
  images: number,
  shape: PipelineShape,
  rates: PipelineRates,
): Projection {
  const count = Math.max(0, Math.round(images));
  const batchSize = Math.max(1, shape.batchSize);
  const concurrency = Math.max(1, shape.leafConcurrency);
  const batches = Math.ceil(count / batchSize);
  const conversionMs = count * rates.msPerImage;
  const analysisMs = Math.ceil(batches / concurrency) * rates.msPerBatch;
  const synthesisMs =
    batches > 0 ? synthesisCallSlots(batches, shape) * rates.msPerSynthesisNode : 0;
  return {
    images: count,
    batches,
    conversionMs,
    analysisMs,
    synthesisMs,
    totalMs: conversionMs + analysisMs + synthesisMs,
  };
}

export type RunForecast = {
  /** 0..100, or undefined while the job has nothing to measure against. */
  percent?: number;
  /** Milliseconds still to go. Undefined when it cannot be told honestly. */
  remainingMs?: number;
  elapsedMs?: number;
  /** True while converting a study whose file count is not known yet. */
  indeterminate: boolean;
};

type ForecastInput = {
  status: JobStatus;
  progress?: JobProgress;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  shape: PipelineShape;
  rates: PipelineRates;
};

/**
 * How far along the job is, and how much longer it has.
 *
 * The percentage is time-weighted, not phase-counted: conversion of 5.000 images
 * and its synthesis are not worth the same third of a bar. Phases already
 * finished contribute their MEASURED duration; the running one contributes its
 * measured fraction; phases not reached yet contribute an estimate from `rates`.
 * The ETA is then the projected total minus what has already elapsed.
 *
 * The one case with no honest answer is conversion in progress: the study is
 * streamed, so the total file count is unknown until the last entry is read.
 * That reports `indeterminate` instead of inventing a denominator — the counter
 * and the images/second rate are what the UI shows meanwhile.
 */
export function forecastRun(input: ForecastInput, now: number): RunForecast {
  const { progress, status, shape, rates } = input;
  const timings = progress?.timings;
  const live = isRunning(status);
  const elapsed = elapsedMs({ ...input, timings }, now);

  if (status === 'done')
    return { percent: 100, remainingMs: 0, elapsedMs: elapsed, indeterminate: false };

  const images = progress?.instanceCount ?? 0;
  const batchesTotal = progress?.batchesTotal ?? 0;
  const batchesDone = Math.min(progress?.batchesDone ?? 0, batchesTotal);

  // Conversion still running with no known total: no denominator exists yet.
  if (live && images === 0 && !progress?.conversionComplete) {
    return { elapsedMs: elapsed, indeterminate: true };
  }

  const measuredConversion = spanMs(timings?.converting, now, live);
  const conversionMs = measuredConversion ?? images * rates.msPerImage;
  const conversionDone = Boolean(progress?.conversionComplete);

  // Analysis: extrapolate from what this run has actually done. Dividing the
  // elapsed analysis time by finished batches absorbs the real concurrency, the
  // provider's real latency and any retry stalls — all things a static rate
  // misses. Falls back to the rate model before the first batch lands.
  const analysisElapsed = spanMs(timings?.analyzing, now, live) ?? 0;
  const projectedAnalysis =
    batchesTotal > 0 && batchesDone > 0
      ? (analysisElapsed / batchesDone) * batchesTotal
      : Math.ceil(Math.max(batchesTotal, 1) / Math.max(1, shape.leafConcurrency)) *
        rates.msPerBatch;

  const synthesisElapsed = spanMs(timings?.synthesizing, now, live);
  const projectedSynthesis =
    synthesisElapsed !== undefined && timings?.synthesizing?.endedAt
      ? synthesisElapsed
      : Math.max(
          synthesisElapsed ?? 0,
          synthesisCallSlots(Math.max(batchesTotal, 1), shape) * rates.msPerSynthesisNode,
        );

  const totalProjected = conversionMs + projectedAnalysis + projectedSynthesis;
  if (totalProjected <= 0) return { elapsedMs: elapsed, indeterminate: false };

  const doneMs =
    (conversionDone ? conversionMs : 0) +
    (batchesTotal > 0 ? (batchesDone / batchesTotal) * projectedAnalysis : 0) +
    (synthesisElapsed ?? 0);

  const percent = Math.max(
    0,
    Math.min(status === 'failed' ? 100 : 99, (doneMs / totalProjected) * 100),
  );
  return {
    percent,
    remainingMs: live ? Math.max(0, totalProjected - doneMs) : undefined,
    elapsedMs: elapsed,
    indeterminate: false,
  };
}

/**
 * Turn a job's own measurements into rates. A job that converted images and ran
 * batches describes this deployment better than any constant can — the baseline
 * only fills the gaps, and `source` says how much of the answer is real.
 */
export function ratesFromJob(
  metrics:
    | { msPerImage?: number; msPerBatch?: number; synthesisMs?: number; batchesTotal?: number }
    | undefined,
  shape: PipelineShape,
): PipelineRates {
  const msPerImage = metrics?.msPerImage;
  const msPerBatch = metrics?.msPerBatch;
  const slots =
    metrics?.batchesTotal && metrics.batchesTotal > 0
      ? synthesisCallSlots(metrics.batchesTotal, shape)
      : undefined;
  const msPerSynthesisNode =
    metrics?.synthesisMs && slots ? metrics.synthesisMs / slots : undefined;

  const measured = [msPerImage, msPerBatch, msPerSynthesisNode].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  ).length;

  return {
    msPerImage: msPerImage && msPerImage > 0 ? msPerImage : BASELINE_RATES.msPerImage,
    msPerBatch: msPerBatch && msPerBatch > 0 ? msPerBatch : BASELINE_RATES.msPerBatch,
    msPerSynthesisNode:
      msPerSynthesisNode && msPerSynthesisNode > 0
        ? msPerSynthesisNode
        : msPerBatch && msPerBatch > 0
          ? msPerBatch
          : BASELINE_RATES.msPerSynthesisNode,
    source: measured === 3 ? 'measured' : measured === 0 ? 'baseline' : 'mixed',
  };
}
