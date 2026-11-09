'use client';

import { Loader2 } from 'lucide-react';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { NfeSyncForecast } from '@/app/lib/jobs/nfe-sync-estimate';
import type { NfeSyncProgress } from '@/app/lib/types/jobs';
import { Badge } from '@/components/ui/badge';

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}min ${totalSeconds % 60}s`;
}

function Counter({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`text-lg font-semibold tabular-nums ${danger ? 'text-destructive' : ''}`}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Live view of a "Buscar na SEFAZ" run: percent, time left, and what each
 * document turned into. Fed by `progress.nfe` + `nfeSyncForecast`, so the
 * Stock page and the job detail show the same numbers.
 */
export function NfeSyncProgressCard({
  progress,
  forecast,
}: {
  progress: NfeSyncProgress;
  forecast: NfeSyncForecast;
}) {
  const copy = useCopy().rawIngredients.syncProgress;
  const phaseLabel =
    progress.phase === 'fetching'
      ? copy.fetching
      : progress.phase === 'blocked'
        ? copy.blocked
        : progress.phase === 'paused'
          ? copy.paused
          : copy.processing;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-sm font-medium">{phaseLabel}</span>
          {progress.source === 'simulated' ? (
            <Badge variant="outline">{copy.simulatedBadge}</Badge>
          ) : null}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {forecast.indeterminate ? '—' : `${forecast.percent}%`}
          </span>
          <span className="text-xs text-muted-foreground">
            {forecast.remainingMs !== undefined
              ? formatCopy(copy.remaining, { time: formatRemaining(forecast.remainingMs) })
              : copy.remainingUnknown}
          </span>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-500 ${
            forecast.indeterminate ? 'w-1/3 animate-pulse' : ''
          }`}
          style={forecast.indeterminate ? undefined : { width: `${forecast.percent}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {formatCopy(copy.documents, {
          done: progress.docsDone ?? 0,
          total: progress.docsTotal ?? '—',
          batch: progress.batchesDone ?? 0,
          batches: progress.batchesMax ?? 0,
        })}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Counter label={copy.captured} value={progress.invoicesProcessed ?? 0} />
        <Counter label={copy.duplicates} value={progress.invoicesDuplicate ?? 0} />
        <Counter
          label={copy.failed}
          value={progress.invoicesFailed ?? 0}
          danger={!!progress.invoicesFailed}
        />
        <Counter label={copy.ignored} value={progress.docsIgnored ?? 0} />
        <Counter label={copy.drafted} value={progress.itemsDrafted ?? 0} />
        {progress.invoicesCancelled ? (
          <Counter label={copy.cancelled} value={progress.invoicesCancelled} danger />
        ) : null}
      </div>
    </div>
  );
}
