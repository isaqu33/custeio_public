'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  RotateCw,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '@/app/lib/api-client';
import { endpointForJobRetry } from '@/app/lib/features';
import { formatDateShort, formatTimeShort } from '@/app/lib/date-format';
import { formatMoney } from '@/app/lib/quantity-format';
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

// The one card this job kind needs: there is no multi-stage timeline to walk
// through — a batch of XML files either has or hasn't been read yet. Percent/counts only exist once the job
// has a `result` (set on completion, see app/jobs/sefaz-nfe-received.ts); a
// queued/running job just shows that it is working.
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

// Same shape of noise as the error list: every retry re-logs "worker picked
// job", so fifteen steps are four events seen five times. Runs of the same
// step collapse into one row with a count, and the list reads newest-first,
// because the question is "what happened last".
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

      {isNfeCapture && <NfeCaptureSummary detail={detail} />}
      {isCatalogSync && <CatalogSyncSummary detail={detail} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Full width: an error here is a provider sentence, not a label. Half a
            column forced every one of them into a scroll box nobody could read. */}
        <div className="lg:col-span-2">
          <Errors detail={detail} />
        </div>
        <Steps detail={detail} />
      </div>
    </div>
  );
}
