'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Coins,
  Gauge,
  ImageOff,
  Loader2,
  RotateCw,
  Webhook,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '@/app/lib/api-client';
import { endpointForJobRetry } from '@/app/lib/features';
import { formatDateShort, formatTimeShort } from '@/app/lib/date-format';
import { formatDuration } from '@/app/lib/duration-format';
import { formatMoney } from '@/app/lib/quantity-format';
import {
  DEFAULT_PIPELINE_SHAPE,
  forecastRun,
  isRunning,
  phaseBreakdown,
  projectStudy,
  ratesFromJob,
  type PipelineRates,
  type PipelineShape,
} from '@/app/lib/jobs/estimate';
import { showErrorToast, showSuccessToast } from '@/app/lib/toast';
import type { JobDetail, JobErrorLog, JobStepLog } from '@/app/lib/types/jobs';
import { cn } from '@/app/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { nfeSyncForecast } from '@/app/lib/jobs/nfe-sync-estimate';
import { NfeSyncProgressCard } from '@/components/nfe-sync-progress';

const PHASES = ['converting', 'converted', 'analyzing', 'synthesizing', 'done'] as const;
type Phase = (typeof PHASES)[number];

type PhaseState = 'done' | 'current' | 'pending' | 'error';

function PhaseIcon({ state }: { state: PhaseState }) {
  if (state === 'error') return <XCircle className="size-4 shrink-0 text-destructive" />;
  if (state === 'done') return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  if (state === 'current') return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/40" />;
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className={cn('text-sm font-semibold', danger && 'text-destructive')}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'done') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'secondary';
  if (status === 'canceled') return 'secondary';
  return 'outline';
}

function timestamp(value?: string | Date) {
  if (!value) return '-';
  return `${formatDateShort(value)} ${formatTimeShort(value)}`;
}

const ANALYSIS_JOB_KIND = 'analysis.process.received';
const NFE_CAPTURE_JOB_KIND = 'sefaz.nfe.received';
const CATALOG_SYNC_JOB_KIND = 'pos.catalog.sync';

type NfeCaptureFileResult = {
  fileName: string;
  status: 'processed' | 'duplicate' | 'cancelled' | 'error';
  error?: string;
  itemsMatched?: number;
  itemsDrafted?: number;
};

type NfeCaptureResult = {
  totalFiles?: number;
  filesProcessed?: number;
  filesFailed?: number;
  percentComplete?: number;
  totalItemsMatched?: number;
  totalItemsDrafted?: number;
  invoicesCancelled?: number;
  cancelledValue?: number;
  // Sync mode: stopped by the SEFAZ limit (`paused`), or finished with documents
  // still waiting / a poll scheduled (`resumeAt`), continued by the Crons worker.
  paused?: boolean;
  resumeAt?: string;
  resumeKind?: 'backlog' | 'poll';
  filesOmitted?: number;
  files?: NfeCaptureFileResult[];
};

// The one card this job kind actually needs: unlike the analysis pipeline,
// there is no multi-stage timeline to walk through — a batch of XML files
// either has or hasn't been read yet. Percent/counts only exist once the job
// has a `result` (set on completion, see app/jobs/sefaz-nfe-received.ts); a
// queued/running job just shows that it is working.
function NfeCaptureSummary({ detail }: { detail: JobDetail }) {
  const copy = useCopy().jobs.detail.nfeCapture;
  const result = detail.result as NfeCaptureResult | undefined;
  const live = detail.status === 'queued' || detail.status === 'running';
  const now = useNow(live);

  const nfeProgress = detail.progress?.nfe;
  if (live && nfeProgress) {
    return (
      <Card>
        <CardContent className="pt-6">
          <NfeSyncProgressCard
            progress={nfeProgress}
            forecast={nfeSyncForecast({
              status: detail.status,
              progress: nfeProgress,
              startedAt: detail.progress?.timings?.startedAt,
              now,
            })}
          />
        </CardContent>
      </Card>
    );
  }

  if (live || !result) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {detail.status === 'queued' ? copy.queued : copy.processing}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const percent = result.percentComplete ?? 0;
  const files = result.files ?? [];
  // `resumeAt` is set when the worker will run this store again by itself: after a
  // pause, with documents still waiting, or as the next scheduled check.
  const resumeNotice = result.resumeAt
    ? formatCopy(
        result.paused ? copy.paused : result.resumeKind === 'poll' ? copy.nextPoll : copy.resumes,
        { time: timestamp(result.resumeAt) },
      )
    : null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{Math.round(percent)}%</span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {copy.overall}
            </span>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-700',
              (result.filesFailed ?? 0) > 0 ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>

        {resumeNotice ? (
          <p className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{resumeNotice}</span>
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:grid-cols-4">
          <Stat
            label={copy.filesProcessed}
            value={`${result.filesProcessed ?? 0}/${result.totalFiles ?? 0}`}
          />
          <Stat
            label={copy.filesFailed}
            value={result.filesFailed ?? 0}
            danger={Boolean(result.filesFailed)}
          />
          <Stat label={copy.itemsMatched} value={result.totalItemsMatched ?? 0} />
          <Stat label={copy.itemsDrafted} value={result.totalItemsDrafted ?? 0} />
          {result.invoicesCancelled ? (
            <>
              <Stat label={copy.invoicesCancelled} value={result.invoicesCancelled} />
              <Stat
                label={copy.cancelledValue}
                value={formatMoney(result.cancelledValue ?? 0)}
                danger
              />
            </>
          ) : null}
        </div>

        {result.filesOmitted ? (
          <p className="text-xs text-muted-foreground">
            {formatCopy(copy.filesOmitted, { count: result.filesOmitted })}
          </p>
        ) : null}

        {files.length > 0 ? (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {files.map((file, index) => (
              <li
                key={`${file.fileName}-${index}`}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                  file.status === 'error' && 'border-destructive/40 bg-destructive/5',
                )}
              >
                {file.status === 'error' ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : file.status === 'duplicate' || file.status === 'cancelled' ? (
                  <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="break-all font-mono">{file.fileName}</span>
                  <span className="text-muted-foreground">
                    {file.status === 'error'
                      ? (file.error ?? copy.fileError)
                      : file.status === 'duplicate'
                        ? copy.fileDuplicate
                        : file.status === 'cancelled'
                          ? copy.fileCancelled
                          : formatCopy(copy.fileProcessed, {
                              matched: file.itemsMatched ?? 0,
                              drafted: file.itemsDrafted ?? 0,
                            })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

type CatalogSyncResult = {
  products?: number;
  activeProducts?: number;
  created?: number;
  updated?: number;
  deactivated?: number;
  modifiers?: number;
};

// `pos.catalog.sync` is one Alloy request and a few writes: no timeline to walk
// through, just what it found and what it changed.
function CatalogSyncSummary({ detail }: { detail: JobDetail }) {
  const copy = useCopy().jobs.detail.catalogSync;
  const result = detail.result as CatalogSyncResult | undefined;
  const live = detail.status === 'queued' || detail.status === 'running';

  if (live || !result) {
    if (!live) return null;
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {detail.status === 'queued' ? copy.queued : copy.processing}
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={copy.products} value={result.products ?? 0} />
          <Stat label={copy.activeProducts} value={result.activeProducts ?? 0} />
          <Stat label={copy.created} value={result.created ?? 0} />
          <Stat label={copy.updated} value={result.updated ?? 0} />
          <Stat label={copy.deactivated} value={result.deactivated ?? 0} />
          <Stat label={copy.modifiers} value={result.modifiers ?? 0} />
        </div>
      </CardContent>
    </Card>
  );
}

// Study sizes the projection answers for. 5.000 is the configured instance
// ceiling and 10.000 is the size the commercial tiers ask about — both are kept
// even when they are over the limit, because "that study is refused" is the
// answer to the question, not a reason to hide the row.
const PROJECTION_SIZES = [100, 500, 1_000, 5_000, 10_000] as const;

// A ticking clock, but only while there is something to tick for: a finished job
// has fixed durations, so re-rendering it every second buys nothing.
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function shapeOf(detail: JobDetail): PipelineShape {
  const pipeline = detail.metrics?.pipeline;
  if (!pipeline) return DEFAULT_PIPELINE_SHAPE;
  return {
    batchSize: pipeline.batchSize,
    leafConcurrency: pipeline.leafConcurrency,
    synthesisFanout: pipeline.synthesisFanout,
  };
}

function ratesOf(detail: JobDetail): PipelineRates {
  return ratesFromJob(
    {
      msPerImage: detail.metrics?.msPerImage,
      msPerBatch: detail.metrics?.msPerBatch,
      synthesisMs: detail.metrics?.synthesisMs,
      batchesTotal: detail.progress?.batchesTotal,
    },
    shapeOf(detail),
  );
}

// Overall progress, elapsed time and what is left of the run — the three numbers
// someone opens a running job for, above everything else in the modal.
function RunSummary({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.summary;
  const live = isRunning(detail.status);
  const now = useNow(live);
  const progress = detail.progress;
  const forecast = forecastRun(
    {
      status: detail.status,
      progress,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      shape: shapeOf(detail),
      rates: ratesOf(detail),
    },
    now,
  );
  const failed = detail.status === 'failed';
  const percent = forecast.percent ?? 0;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {forecast.indeterminate ? '—' : `${Math.round(percent)}%`}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {text.overall}
            </span>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {detail.status === 'queued' ? (
              // Nothing has been picked up yet, so the elapsed clock is queue
              // wait, not pipeline time — say which one the reader is looking at.
              <span>{text.queued}</span>
            ) : forecast.indeterminate ? (
              <span>
                {formatCopy(text.convertingCount, { count: progress?.convertedFiles ?? 0 })}
              </span>
            ) : forecast.remainingMs !== undefined ? (
              <span suppressHydrationWarning>
                {formatCopy(text.remaining, { time: formatDuration(forecast.remainingMs) })} ·{' '}
                {formatCopy(text.eta, {
                  time: formatTimeShort(new Date(now + forecast.remainingMs)),
                })}
              </span>
            ) : null}
          </div>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-700',
              failed ? 'bg-destructive' : 'bg-primary',
              // Nothing to measure against yet — a striped bar that moves says
              // "working" without claiming a fraction it cannot know.
              forecast.indeterminate && 'w-1/3 animate-pulse',
            )}
            style={forecast.indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>

        {forecast.indeterminate ? (
          <p className="text-[11px] text-muted-foreground">{text.convertingHint}</p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:grid-cols-6">
          <Stat
            label={live ? text.elapsed : text.duration}
            value={<span suppressHydrationWarning>{formatDuration(forecast.elapsedMs)}</span>}
          />
          <Stat
            label={copy.jobs.detail.pipeline.images}
            value={progress?.instanceCount ?? progress?.convertedFiles ?? '—'}
          />
          <Stat
            label={copy.jobs.detail.pipeline.failedFiles}
            value={progress?.failedFiles ?? 0}
            danger={Boolean(progress?.failedFiles)}
          />
          <Stat
            label={copy.jobs.detail.pipeline.batches}
            value={
              progress?.batchesTotal ? `${progress.batchesDone ?? 0}/${progress.batchesTotal}` : '—'
            }
          />
          <Stat
            label={copy.jobs.detail.pipeline.droppedBatches}
            value={progress?.analysisFailedBatches ?? 0}
            danger={Boolean(progress?.analysisFailedBatches)}
          />
          <Stat
            label={copy.jobs.detail.pipeline.aiTokens}
            value={
              typeof progress?.usage?.totalTokens === 'number'
                ? progress.usage.totalTokens.toLocaleString()
                : '—'
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

// Where the time went. The question this answers is not "how long did the job
// take" (the summary says that) but "which stage is worth optimizing" — which is
// why every stage carries its share of the total next to its duration.
// What the upload actually contained, and what became of each instance.
//
// The point is that it RECONCILES: converted + conversion failures + out of
// scope must equal the instances received. Three unrelated numbers on a page
// can each look reasonable while the study quietly lost a hundred images
// between them; a total that does not add up says so out loud instead, because
// a record you cannot trust is worse than a record that admits it is broken.
function StudyAccounting({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.pipeline;
  const progress = detail.progress;
  if (!progress) return null;

  const converted = progress.instanceCount ?? 0;
  const failed = progress.failedFiles ?? 0;
  const outOfScope = progress.skippedByModality ?? 0;
  const breakdown = progress.modalityBreakdown ?? [];
  // Older jobs predate the counter; fall back to the sum rather than showing a
  // dash, and then the reconciliation trivially holds — which is honest, since
  // there is nothing to reconcile it against.
  const seen = progress.filesSeen ?? converted + failed + outOfScope;
  const reconciles = seen === converted + failed + outOfScope;

  // Nothing to account for yet: a job still converting, or one that never got
  // past the upload.
  if (seen === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{text.accountingTitle}</CardTitle>
        <p className="text-xs text-muted-foreground">{text.accountingHint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:grid-cols-4">
          <Stat label={text.filesSeen} value={seen} />
          <Stat label={text.converted} value={converted} />
          <Stat label={text.failedFiles} value={failed} danger={Boolean(failed)} />
          <Stat label={text.outOfScope} value={outOfScope} />
        </div>

        {!reconciles ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {text.accountingMismatch}
          </p>
        ) : null}

        {breakdown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-xs">
              <thead>
                <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-4 font-medium">{text.modalityColumn}</th>
                  <th className="py-1.5 pr-4 font-medium">{text.analyzedColumn}</th>
                  <th className="py-1.5 font-medium">{text.skippedColumn}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.modality ?? '—'} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-mono">{row.modality ?? '—'}</td>
                    <td className="py-1.5 pr-4">{row.accepted ?? 0}</td>
                    <td
                      className={
                        row.skipped ? 'py-1.5 text-amber-600 dark:text-amber-400' : 'py-1.5'
                      }
                    >
                      {row.skipped ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PhaseTimings({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.timings;
  const live = isRunning(detail.status);
  const now = useNow(live);
  const { phases, accountedMs } = phaseBreakdown(detail.progress?.timings, detail.status, now);
  const rates = ratesOf(detail);
  const metrics = detail.metrics;
  const shape = shapeOf(detail);
  const measured = phases.some((entry) => entry.ms !== undefined);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" /> {text.title}
        </CardTitle>
        {accountedMs > 0 ? (
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            {formatDuration(accountedMs)}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {measured ? (
          <ul className="space-y-2">
            {phases.map((entry) => (
              <li key={entry.phase} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn(entry.ms === undefined && 'text-muted-foreground')}>
                    {text[entry.phase]}
                    {entry.running ? (
                      <span className="ml-1 text-xs text-primary">· {text.running}</span>
                    ) : null}
                    {entry.fromPreviousRun ? (
                      <span className="ml-1 text-xs text-muted-foreground">· {text.reused}</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-muted-foreground" suppressHydrationWarning>
                    {formatDuration(entry.ms)}
                    {entry.share !== undefined ? (
                      <span className="ml-2 text-xs">{Math.round(entry.share * 100)}%</span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      entry.fromPreviousRun ? 'bg-muted-foreground/40' : 'bg-primary/70',
                    )}
                    style={{ width: `${Math.round((entry.share ?? 0) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{text.empty}</p>
        )}

        <div className="space-y-0.5 rounded-md border bg-muted/30 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3" /> {text.pace}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCopy(text.perImage, { value: formatDuration(rates.msPerImage) })}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCopy(text.perBatch, {
              value: formatDuration(rates.msPerBatch),
              size: shape.batchSize,
            })}
          </p>
          {metrics?.synthesisMs ? (
            <p className="text-xs text-muted-foreground">
              {formatCopy(text.perReport, { value: formatDuration(metrics.synthesisMs) })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// The commercial question, answered with this deployment's own numbers: a study
// of N images would take this long, on the concurrency configured right now.
function Projection({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.projection;
  const shape = shapeOf(detail);
  const rates = ratesOf(detail);
  const maxInstances = detail.metrics?.pipeline.maxInstances;
  const own = detail.progress?.instanceCount;

  // This study first (when it has a size), then the reference sizes — with its
  // own count deduplicated so a 1.000-image study is not listed twice.
  const rows = [
    ...(own ? [{ images: own, label: text.thisStudy }] : []),
    ...PROJECTION_SIZES.filter((size) => size !== own).map((size) => ({
      images: size,
      label: undefined,
    })),
  ].sort((a, b) => a.images - b.images);

  const sourceNote =
    rates.source === 'measured'
      ? text.sourceMeasured
      : rates.source === 'mixed'
        ? text.sourceMixed
        : text.sourceBaseline;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{text.title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {formatCopy(text.description, {
            batch: shape.batchSize,
            concurrency: shape.leafConcurrency,
            fanout: shape.synthesisFanout,
          })}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 text-left font-normal">{text.images}</th>
                <th className="pb-1 text-right font-normal">{text.conversion}</th>
                <th className="pb-1 text-right font-normal">{text.analysis}</th>
                <th className="pb-1 text-right font-normal">{text.report}</th>
                <th className="pb-1 text-right font-normal">{text.total}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const projection = projectStudy(row.images, shape, rates);
                const overLimit = Boolean(maxInstances && row.images > maxInstances);
                return (
                  <tr key={row.images} className="border-t">
                    <td className="py-1.5 tabular-nums">
                      {row.images.toLocaleString()}
                      {row.label ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">({row.label})</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {formatDuration(projection.conversionMs)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {formatDuration(projection.analysisMs)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {formatDuration(projection.synthesisMs)}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 text-right font-medium tabular-nums',
                        overLimit && 'text-muted-foreground line-through',
                      )}
                    >
                      {formatDuration(projection.totalMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {maxInstances && rows.some((row) => row.images > maxInstances) ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            {formatCopy(text.overLimit, { max: maxInstances.toLocaleString() })}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {sourceNote} {text.note}
        </p>
      </CardContent>
    </Card>
  );
}

// The Jobs page is a support console; the report is read on the page that matches
// the door the study came through. Rather than describing where to go, this links
// there with the study's own reference already in the search — the reference is
// searchable exactly so this link can land on the row.
function WhereToRead({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.whereToRead;
  if (!detail.source) return null;
  const portal = detail.source === 'portal';
  const reference = detail.examId;
  const href = `${portal ? '/organization/new-analysis' : '/organization/analyses'}${
    reference ? `?q=${encodeURIComponent(reference)}` : ''
  }`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" /> {text.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{portal ? text.portal : text.integration}</p>
        {reference ? <p className="select-all font-mono text-xs">{reference}</p> : null}
        <p className="text-xs text-muted-foreground">{text.partialsHint}</p>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            {text.open}
            <ExternalLink className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Which file failed and why. The count alone ("3 failed files") sends support
// looking through a 400-file study by hand; the name and DCMTK's own sentence
// are what identify a corrupt instance or an unsupported transfer syntax.
function FailedImages({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const text = copy.jobs.detail.failedImages;
  const metrics = detail.metrics;
  if (!metrics || metrics.failedImages.length === 0) return null;
  const hidden = metrics.failedImagesTotal - metrics.failedImages.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageOff className="size-4" /> {text.title}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{metrics.failedImagesTotal}</span>
      </CardHeader>
      <CardContent>
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {metrics.failedImages.map((image, index) => (
            <li
              key={`${image.fileName}-${image.batchIndex ?? index}`}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <p className="break-all font-mono text-xs">{image.fileName}</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {image.batchIndex !== undefined
                  ? `${formatCopy(text.position, { index: image.batchIndex })} · `
                  : ''}
                {image.error ?? text.noReason}
              </p>
            </li>
          ))}
        </ul>
        {hidden > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {formatCopy(text.more, { count: hidden })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Maps a pipeline step to the phase whose clock covers it. `converted` and
// `done` are markers, not stages — nothing is spent in them.
const PHASE_CLOCK = {
  converting: 'converting',
  analyzing: 'analyzing',
  synthesizing: 'synthesizing',
} as const;

function Pipeline({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const phaseLabels = copy.jobs.detail.pipeline.phases;
  const progress = detail.progress;
  const live = isRunning(detail.status);
  const now = useNow(live);
  const { phases: spans } = phaseBreakdown(progress?.timings, detail.status, now);
  const failed = detail.status === 'failed';
  const done = detail.status === 'done';
  const currentIndex = progress?.phase ? PHASES.indexOf(progress.phase as Phase) : -1;
  const attribution = progress?.aiAttribution ?? [];
  const batchesPct = progress?.batchesTotal
    ? Math.min(100, ((progress.batchesDone ?? 0) / progress.batchesTotal) * 100)
    : 0;

  function phaseState(index: number): PhaseState {
    if (failed && index === currentIndex) return 'error';
    if (done || (currentIndex >= 0 && index < currentIndex)) return 'done';
    if (index === currentIndex) return 'current';
    return 'pending';
  }

  const currentPhase = currentIndex >= 0 ? PHASES[currentIndex] : undefined;
  const currentLabel = currentPhase
    ? phaseLabels[currentPhase]
    : copy.jobs.detail.pipeline.waitingToStart;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{copy.jobs.detail.pipeline.title}</CardTitle>
        <span
          className={cn(
            'text-xs font-medium',
            failed ? 'text-destructive' : done ? 'text-emerald-500' : 'text-primary',
          )}
        >
          {failed ? copy.jobs.detail.pipeline.failed : currentLabel}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          {PHASES.map((phase, index) => {
            const state = phaseState(index);
            const isAnalyzing =
              phase === 'analyzing' && state === 'current' && progress?.batchesTotal;
            const clockKey = PHASE_CLOCK[phase as keyof typeof PHASE_CLOCK];
            const clockMs = clockKey
              ? spans.find((entry) => entry.phase === clockKey)?.ms
              : undefined;
            return (
              <li key={phase} className="flex items-center gap-2 text-sm">
                <PhaseIcon state={state} />
                <span
                  className={cn(
                    state === 'pending' && 'text-muted-foreground',
                    state === 'current' && 'font-medium text-primary',
                    state === 'error' && 'font-medium text-destructive',
                  )}
                >
                  {phaseLabels[phase]}
                </span>
                {isAnalyzing ? (
                  <span className="text-xs text-muted-foreground">
                    {formatCopy(copy.jobs.detail.pipeline.batchProgress, {
                      done: progress?.batchesDone ?? 0,
                      total: progress?.batchesTotal ?? 0,
                    })}
                  </span>
                ) : null}
                {/* The conversion counter, while it is the one running: a study
                    that streams for twelve minutes otherwise shows nothing at all
                    for the whole of it. */}
                {phase === 'converting' && state === 'current' && progress?.convertedFiles ? (
                  <span className="text-xs text-muted-foreground">
                    {formatCopy(copy.jobs.detail.pipeline.batchProgress, {
                      done: progress.convertedFiles,
                      total: '…',
                    })}
                  </span>
                ) : null}
                {clockMs !== undefined ? (
                  <span
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {formatDuration(clockMs)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {progress?.analysisFailedBatches ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {formatCopy(
              progress.analysisFailedBatches === 1
                ? copy.jobs.detail.pipeline.partialAnalysisOne
                : copy.jobs.detail.pipeline.partialAnalysisMany,
              { count: progress.analysisFailedBatches },
            )}
          </div>
        ) : null}

        {/* Who actually answered. Only rendered when a fallback took part or more
            than one model did: with a single model doing everything, naming it
            adds a line that says nothing. */}
        {attribution.length > 0 && (attribution.length > 1 || attribution[0]?.fallback) ? (
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {copy.jobs.detail.pipeline.aiUsed}
            </p>
            {attribution.map((row) => (
              <div
                key={`${row.provider}-${row.model}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="font-mono">
                  {row.provider}
                  {row.model ? `/${row.model}` : ''}
                </span>
                <span className="text-muted-foreground">
                  {formatCopy(copy.jobs.detail.pipeline.aiBatches, { count: row.batches ?? 0 })}
                </span>
                {row.fallback ? (
                  <Badge variant="secondary">{copy.jobs.detail.pipeline.aiFallback}</Badge>
                ) : null}
              </div>
            ))}
            {progress?.aiSynthesis?.provider ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono">
                  {progress.aiSynthesis.provider}
                  {progress.aiSynthesis.model ? `/${progress.aiSynthesis.model}` : ''}
                </span>
                <span className="text-muted-foreground">{copy.jobs.detail.pipeline.aiReport}</span>
                {progress.aiSynthesis.fallback ? (
                  <Badge variant="secondary">{copy.jobs.detail.pipeline.aiFallback}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {progress?.multiFrameInstances ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {formatCopy(
              progress.multiFrameInstances === 1
                ? copy.jobs.detail.pipeline.multiFrameOne
                : copy.jobs.detail.pipeline.multiFrameMany,
              { count: progress.multiFrameInstances },
            )}
          </div>
        ) : null}

        {/* EXAM SCOPE — answers "why did my 400-image study come back as 12?"
            on the page support is already looking at, naming what was dropped. */}
        {progress?.skippedByModality ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {formatCopy(
              progress.skippedByModality === 1
                ? copy.jobs.detail.pipeline.outOfScopeOne
                : copy.jobs.detail.pipeline.outOfScopeMany,
              {
                count: progress.skippedByModality,
                modalities: (progress.modalityBreakdown ?? [])
                  .filter((row) => (row.skipped ?? 0) > 0)
                  .map((row) => row.modality)
                  .filter(Boolean)
                  .join(', '),
              },
            )}
          </div>
        ) : null}

        {progress?.billable === false ? (
          <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            {copy.jobs.detail.pipeline.notBillable}
          </div>
        ) : null}

        {progress?.batchesTotal ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{copy.jobs.detail.pipeline.batchesAnalyzed}</span>
              <span>{Math.round(batchesPct)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', failed ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${batchesPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// PLATFORM BILLING — what this study cost, per model. The job is the only place
// that can answer it honestly: the organization's meter is a monthly total, and
// the tokens of a study answered by two providers do not divide by provider
// anywhere else. Every column is shown rather than just the final amount, because
// the number people distrust is the one that arrives without its arithmetic.
function AiCost({ detail }: { detail: JobDetail }) {
  const allCopy = useCopy();
  const copy = allCopy.jobs.detail.cost;
  const cost = detail.metrics?.cost;
  const images = detail.progress?.instanceCount ?? detail.progress?.convertedFiles ?? 0;

  // The platform bills in BRL whatever the UI language is, so the currency is
  // fixed while grouping/decimals follow the reader's browser locale — the same
  // convention the rest of this file uses via toLocaleString.
  const fmt = React.useMemo(
    () => ({
      brl: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BRL' }),
      // Provider amounts for one study land in the cents — a currency default
      // would round every one of them to R$ 0,00 and say nothing.
      usd: new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 4,
      }),
      brlPrecise: new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 4,
      }),
      num: new Intl.NumberFormat(undefined),
      decimal: new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }),
    }),
    [],
  );

  if (!cost) return null;

  const attributionGap = cost.totalTokens > 0 && cost.attributedTokens < cost.totalTokens;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="size-4" />
          {copy.title}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {formatCopy(copy.rates, {
            margin: fmt.decimal.format(cost.margin),
            fx: fmt.decimal.format(cost.usdToBrl),
          })}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{copy.hint}</p>

        {attributionGap ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {formatCopy(copy.gap, {
              attributed: fmt.num.format(cost.attributedTokens),
              total: fmt.num.format(cost.totalTokens),
            })}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 pr-3 font-normal">{copy.model}</th>
                <th className="pb-1 pr-3 text-right font-normal">{copy.batches}</th>
                <th className="pb-1 pr-3 text-right font-normal">{copy.tokens}</th>
                <th className="pb-1 pr-3 text-right font-normal">{copy.listPrice}</th>
                <th className="pb-1 pr-3 text-right font-normal">{copy.providerCost}</th>
                <th className="pb-1 text-right font-normal">{copy.billed}</th>
              </tr>
            </thead>
            <tbody>
              {cost.rows.map((row) => (
                <tr key={`${row.provider}-${row.model}`} className="border-t">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono">
                      {row.provider}
                      {row.model ? `/${row.model}` : ''}
                    </span>
                    {row.fallback ? (
                      <Badge variant="secondary" className="ml-2">
                        {allCopy.jobs.detail.pipeline.aiFallback}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {row.batches > 0 ? fmt.num.format(row.batches) : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {fmt.num.format(row.totalTokens)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    <span title={row.priceIsFallback ? copy.estimatedHint : undefined}>
                      {fmt.usd.format(row.priceInputUsd)} / {fmt.usd.format(row.priceOutputUsd)}
                      {row.priceIsFallback ? ' *' : ''}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {fmt.usd.format(row.providerUsd)}
                  </td>
                  <td className="py-1.5 text-right font-medium tabular-nums">
                    {fmt.brlPrecise.format(row.billedBrl)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td className="pt-2 pr-3 font-medium" colSpan={4}>
                  {copy.total}
                </td>
                <td className="pt-2 pr-3 text-right tabular-nums">
                  {fmt.usd.format(cost.providerUsd)}
                </td>
                <td className="pt-2 text-right text-sm font-semibold tabular-nums">
                  {fmt.brl.format(cost.billedBrl)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {cost.rows.some((row) => row.priceIsFallback) ? (
          <p className="text-[11px] text-muted-foreground">* {copy.estimatedHint}</p>
        ) : null}

        {/* The number that transfers to a price list: what one image of THIS
            study cost. A study's total says nothing about the next study; the
            per-image figure is what a band in the price table is built from. */}
        {images > 0 ? (
          <p className="text-xs text-muted-foreground">
            {formatCopy(copy.perImage, {
              value: fmt.brlPrecise.format(cost.billedBrl / images),
            })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Same shape of noise as the error list: every retry re-logs "worker picked job"
// and "reused N converted images", so fifteen steps are four events seen five
// times. Runs of the same step collapse into one row with a count, and the list
// reads newest-first — the Pipeline card above already tells the story forwards;
// what this one is asked is "what happened last".
type StepGroup = {
  message: string;
  step?: string;
  failed: boolean;
  count: number;
  lastAt?: string | Date;
};

function groupSteps(logs: JobStepLog[], fallback: string): StepGroup[] {
  const groups: StepGroup[] = [];
  logs.forEach((entry) => {
    const message = entry.message ?? entry.step ?? entry.jobStatus ?? fallback;
    const failed = entry.jobStatus === 'failed';
    const previous = groups.at(-1);
    // Consecutive only: collapsing across the whole list would merge two
    // separate runs of the same step and lose the order they happened in.
    if (
      previous &&
      previous.message === message &&
      previous.step === entry.step &&
      previous.failed === failed
    ) {
      previous.count += 1;
      if (timeValue(entry.timestamp) >= timeValue(previous.lastAt))
        previous.lastAt = entry.timestamp;
      return;
    }
    groups.push({ message, step: entry.step, failed, count: 1, lastAt: entry.timestamp });
  });
  return groups.reverse();
}

function Steps({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const groups = groupSteps(detail.logs, copy.jobs.detail.steps.fallback);
  if (groups.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{copy.jobs.detail.steps.title}</CardTitle>
        <span className="text-xs text-muted-foreground">{groups.length}</span>
      </CardHeader>
      <CardContent>
        {/* Still bounded — the step log is append-only — but with room to breathe
            now that repeats collapse. */}
        <ol className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
          {groups.map((group, index) => {
            const isLatest = index === 0;
            return (
              <li
                key={`${group.step ?? ''}-${group.message}-${index}`}
                className={cn(
                  'flex gap-3 rounded-md px-2 py-1.5 text-sm',
                  isLatest && 'bg-muted/50',
                )}
              >
                {group.failed ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      isLatest ? 'text-primary' : 'text-emerald-500/70',
                    )}
                  />
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="break-words">{group.message}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.step ? `${group.step} · ` : ''}
                    {group.count > 1
                      ? `${formatCopy(copy.jobs.detail.steps.occurrences, { count: group.count })} · `
                      : ''}
                    <span suppressHydrationWarning>{timestamp(group.lastAt)}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// The provider's own words cannot be translated, but WHY it failed can: a stored
// failure code becomes a localized label in front of the raw message. An unknown
// or absent code renders nothing, so older jobs read exactly as before.
function ErrorCodeLabel({ code }: { code?: string }) {
  const copy = useCopy();
  const labels: Record<string, string> = copy.jobs.detail.errors.codes;
  const label = code ? labels[code] : undefined;
  if (!label) return null;
  // Solid rather than outlined: a red label on a dark red-tinted row was the least
  // readable thing in the card, and this is the one word that says what went wrong.
  return (
    <Badge variant="destructive" className="shadow-none">
      {label}
    </Badge>
  );
}

// Repeats are the norm here, not the exception: the queue retries a job and each
// attempt re-records the same rejection, so eleven entries are usually two or
// three distinct problems. Grouping them is what buys the room to actually read
// one — and the newest goes first, because the last attempt is what the reader
// came for and it used to sit at the bottom of a tiny scroll, behind failures
// that had already been fixed.
type ErrorGroup = {
  code?: string;
  message: string;
  count: number;
  attempts: number[];
  lastAt?: string | Date;
};

function timeValue(value?: string | Date): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Provider errors carry per-call identifiers — Azure stamps every one with its own
// `RequestId:` and `Time:` — so six copies of a single failure arrive as six
// different strings and defeat the grouping exactly where it is needed most. Only
// the grouping KEY is normalized; the message on screen is still the real one,
// identifiers included, taken from the most recent occurrence.
function groupKeyOf(message: string): string {
  return message
    .replace(/RequestId:\S+/gi, 'RequestId:*')
    .replace(/Time:\S+/gi, 'Time:*')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '*')
    .trim();
}

function groupErrors(entries: JobErrorLog[], unknownLabel: string): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  entries.forEach((entry) => {
    const message = entry.message ?? unknownLabel;
    const key = `${entry.code ?? ''}|${groupKeyOf(message)}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        code: entry.code,
        message,
        count: 1,
        attempts: entry.attempt ? [entry.attempt] : [],
        lastAt: entry.timestamp,
      });
      return;
    }
    group.count += 1;
    if (entry.attempt && !group.attempts.includes(entry.attempt))
      group.attempts.push(entry.attempt);
    if (timeValue(entry.timestamp) >= timeValue(group.lastAt)) {
      group.lastAt = entry.timestamp;
      // Show the newest occurrence's text, so the identifiers on screen are the
      // ones worth pasting into a provider's support ticket.
      group.message = message;
    }
  });
  return [...groups.values()].sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt));
}

// How many distinct problems are shown before the list asks to be expanded.
const VISIBLE_ERROR_GROUPS = 4;

function Errors({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const [expanded, setExpanded] = React.useState(false);
  const groups = groupErrors(detail.errorLogs, copy.jobs.detail.errors.unknown);
  if (groups.length === 0) return null;

  const visible = expanded ? groups : groups.slice(0, VISIBLE_ERROR_GROUPS);
  const hidden = groups.length - visible.length;

  return (
    <Card className="border-destructive/50">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <XCircle className="size-4" /> {copy.jobs.detail.errors.title}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{groups.length}</span>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {visible.map((group) => (
            <li
              key={`${group.code ?? ''}-${group.message}`}
              className="rounded-md border border-l-4 border-destructive/25 border-l-destructive bg-destructive/5 p-3"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <ErrorCodeLabel code={group.code} />
                {group.count > 1 ? (
                  // Neutral on purpose: how MANY times is metadata, not severity.
                  // Painting it red too made every row shout at the same volume.
                  <Badge variant="secondary" className="font-mono">
                    {formatCopy(copy.jobs.detail.errors.occurrences, { count: group.count })}
                  </Badge>
                ) : null}
              </div>
              {/* Provider messages are long and full of ids — wrap them instead of
                  clipping, since the tail is often where the actionable part is.
                  Rendered in the normal text color: red-on-red was unreadable, and
                  the border and badge already carry the severity. */}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {group.message}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {group.attempts.length > 1
                  ? formatCopy(copy.jobs.detail.errors.attempts, {
                      list: group.attempts.sort((a, b) => a - b).join(', '),
                    })
                  : group.attempts.length === 1
                    ? formatCopy(copy.jobs.detail.errors.attempt, { count: group.attempts[0] ?? 0 })
                    : ''}
                <span suppressHydrationWarning>{timestamp(group.lastAt)}</span>
              </p>
            </li>
          ))}
        </ul>

        {groups.length > VISIBLE_ERROR_GROUPS ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded
              ? copy.jobs.detail.errors.showLess
              : formatCopy(copy.jobs.detail.errors.showAll, { count: hidden })}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WebhookCard({ detail }: { detail: JobDetail }) {
  const copy = useCopy();
  const webhook = detail.webhook;
  if (!webhook || webhook.delivered === undefined) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="size-4" /> {copy.jobs.detail.webhook.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          {webhook.delivered ? (
            <Badge variant="default">{copy.jobs.detail.webhook.delivered}</Badge>
          ) : (
            <Badge variant="destructive">{copy.jobs.detail.webhook.deliveryFailed}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatCopy(copy.jobs.detail.webhook.attempts, {
              count: webhook.attempts ?? 0,
              status: webhook.lastStatus ?? '-',
            })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span suppressHydrationWarning>{timestamp(webhook.deliveredAt)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

// Presentational body of the job detail — rendered inside the detail modal.
// `onRetried` lets the modal re-fetch after a successful retry.
export function JobDetailBody({
  detail,
  onRetried,
}: {
  detail: JobDetail;
  onRetried?: () => void;
}) {
  const router = useRouter();
  const copy = useCopy();
  const [retrying, setRetrying] = React.useState(false);
  // A finished job has nothing to retry: re-running it re-enqueues work that is
  // already done, and the button sitting next to a green "done" badge reads as
  // an action the reader is expected to take. Failed and canceled jobs keep it —
  // that is where a retry resumes from the checkpoint.
  const canRetry = ['failed', 'canceled'].includes(detail.status);
  const isAnalysis = detail.kind === ANALYSIS_JOB_KIND;
  const isNfeCapture = detail.kind === NFE_CAPTURE_JOB_KIND;
  const isCatalogSync = detail.kind === CATALOG_SYNC_JOB_KIND;

  async function onRetry() {
    setRetrying(true);
    try {
      await apiFetch(endpointForJobRetry(detail._id), { method: 'POST' });
      showSuccessToast(copy.jobs.detail.retried);
      router.refresh();
      onRetried?.();
    } catch {
      showErrorToast();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={statusVariant(detail.status)} className="first-letter:uppercase">
            {copy.jobStatus[detail.status as keyof typeof copy.jobStatus] ?? detail.status}
          </Badge>
          <span
            className={
              detail.kind && detail.kind in copy.jobs.filters.kindLabels ? '' : 'capitalize'
            }
          >
            {(detail.kind &&
              copy.jobs.filters.kindLabels[
                detail.kind as keyof typeof copy.jobs.filters.kindLabels
              ]) ||
              (detail.kind ?? detail.type)}
          </span>
          <span>·</span>
          <span suppressHydrationWarning>{timestamp(detail.createdAt)}</span>
          {detail.correlationId && (
            <>
              <span>·</span>
              {/* The value the whole pipeline logs under — support pastes it into
                  the log search to get every line for this job. */}
              <span className="select-all font-mono text-xs" title={copy.jobs.detail.correlationId}>
                {detail.correlationId}
              </span>
            </>
          )}
        </div>
        {canRetry && (
          <Button onClick={onRetry} disabled={retrying} variant="outline" size="sm">
            {retrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            {copy.jobs.detail.retry}
          </Button>
        )}
      </div>

      {detail.status === 'failed' && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {copy.jobs.detail.failedBanner}
        </div>
      )}

      {/* Order follows the questions people actually arrive with: how far along
          is it and how long is left, then where the time is going, then what
          happened, and only then the reference material. */}
      {isAnalysis && <RunSummary detail={detail} />}
      {isNfeCapture && <NfeCaptureSummary detail={detail} />}
      {isCatalogSync && <CatalogSyncSummary detail={detail} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Analysis-only: the stages below are DICOM conversion and AI synthesis,
            which a CSV export never goes through. */}
        {isAnalysis && <Pipeline detail={detail} />}
        {isAnalysis && <PhaseTimings detail={detail} />}
        {isAnalysis && <StudyAccounting detail={detail} />}
        {isAnalysis && (
          <div className="lg:col-span-2">
            <AiCost detail={detail} />
          </div>
        )}
        {/* Full width: an error here is a provider sentence, not a label. Half a
            column forced every one of them into a scroll box nobody could read. */}
        <div className="lg:col-span-2">
          <Errors detail={detail} />
        </div>
        <Steps detail={detail} />
        <WhereToRead detail={detail} />
        <FailedImages detail={detail} />
        {isAnalysis && (
          <div className="lg:col-span-2">
            <Projection detail={detail} />
          </div>
        )}
        <WebhookCard detail={detail} />
      </div>
    </div>
  );
}
