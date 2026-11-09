// How far a SEFAZ-sync run is and how long it has left. Pure, like estimate.ts
// (the analysis pipeline's model): the worker writes counters and a start time,
// every derived number is computed here so the job card, the Stock page and the
// tests agree on one model.

import type { JobStatus, NfeSyncProgress } from '@/app/lib/types/jobs';

export type NfeSyncForecast = {
  /** 0..100. Held at 99 while running: only a finished job is 100. */
  percent: number;
  elapsedMs: number;
  /** Undefined until at least one document has been processed — no rate yet. */
  remainingMs?: number;
  /** No denominator yet (still fetching): the UI shows a working state, not a %. */
  indeterminate: boolean;
};

export function nfeSyncForecast(input: {
  status: JobStatus;
  progress?: NfeSyncProgress;
  startedAt?: string | Date;
  now: number;
}): NfeSyncForecast {
  const started = input.startedAt ? new Date(input.startedAt).getTime() : NaN;
  const elapsedMs = Number.isNaN(started) ? 0 : Math.max(0, input.now - started);

  if (input.status === 'done')
    return { percent: 100, elapsedMs, remainingMs: 0, indeterminate: false };

  const total = input.progress?.docsTotal ?? 0;
  const done = Math.min(input.progress?.docsDone ?? 0, total);
  if (total <= 0) return { percent: 0, elapsedMs, indeterminate: true };

  const percent = Math.min(99, Math.round((done / total) * 100));
  const remainingMs = done > 0 ? Math.round((elapsedMs / done) * (total - done)) : undefined;
  return { percent, elapsedMs, remainingMs, indeterminate: false };
}
