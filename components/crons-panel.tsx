'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pause, Pencil, Play } from 'lucide-react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { formatDateShort, formatTimeShort } from '@/app/lib/date-format';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { CronKey } from '@/app/lib/crons/definitions';
import { SEFAZ_POLL_MAX_MINUTES, SEFAZ_POLL_MIN_MINUTES } from '@/app/lib/sefaz-sync-gate';
import type { CronsOverview } from '@/app/lib/services/crons-overview';
import type { CronRow } from '@/app/lib/services/crons';
import type { SefazPollingStore } from '@/app/lib/services/sefaz-polling';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { DataTableCard } from '@/components/data-table-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function when(value: string | undefined, never: string) {
  if (!value) return never;
  return `${formatDateShort(value)} ${formatTimeShort(value)}`;
}

type IntervalTarget = {
  title: string;
  value: number;
  min: number;
  max: number;
  save: (_minutes: number) => Promise<void>;
};

/** Small form to change one interval; the caller decides what saving does. */
function IntervalDialog({
  target,
  onClose,
}: {
  target: IntervalTarget | null;
  onClose: () => void;
}) {
  const copy = useCopy().crons;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastTarget, setLastTarget] = useState<IntervalTarget | null>(null);

  // Reset the field each time a different row is opened.
  if (target !== lastTarget) {
    setLastTarget(target);
    if (target) setText(String(target.value));
  }

  const minutes = Number(text);
  const valid =
    target !== null && Number.isInteger(minutes) && minutes >= target.min && minutes <= target.max;

  async function save() {
    if (!target || !valid) return;
    setSaving(true);
    try {
      await target.save(minutes);
      onClose();
    } catch {
      // Already toasted by the caller; keep the dialog open so the value can be fixed.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy.editTitle}</DialogTitle>
          <DialogDescription>{target?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cron-interval">{copy.intervalLabel}</Label>
          <Input
            id="cron-interval"
            type="number"
            inputMode="numeric"
            autoFocus
            min={target?.min}
            max={target?.max}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {target ? (
            <p className="text-xs text-muted-foreground">
              {formatCopy(copy.intervalHint, { min: target.min, max: target.max })}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            data-e2e-id="crons-interval-save"
            onClick={() => void save()}
            disabled={saving || !valid}
            className="w-full"
          >
            {saving ? copy.saving : copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StateBadge({ on, label }: { on: boolean; label: string }) {
  return <Badge variant={on ? 'default' : 'outline'}>{label}</Badge>;
}

/**
 * System > Crons: what the worker runs on a schedule, and each store's automatic
 * SEFAZ search, with pause/resume and interval. Every change goes through the
 * Crons API and the page is refreshed from the server, so the table never shows
 * a state the database does not have.
 */
export function CronsPanel({ overview }: { overview: CronsOverview }) {
  const copy = useCopy().crons;
  const router = useRouter();
  const [target, setTarget] = useState<IntervalTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(id: string, endpoint: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await apiFetch(endpoint, { method: 'POST', body, cache: 'no-store' });
      showSuccessToast(copy.updated);
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
      throw err;
    } finally {
      setBusy(null);
    }
  }

  const updateCron = (key: CronKey, body: { enabled?: boolean; intervalMinutes?: number }) =>
    send(`cron:${key}`, endpointFor(AppFeature.CRONS_UPDATE), { key, ...body });

  const updateStore = (storeId: string, body: { enabled?: boolean; intervalMinutes?: number }) =>
    send(`store:${storeId}`, endpointFor(AppFeature.CRONS_UPDATE_STORE_POLLING), {
      storeId,
      ...body,
    });

  // Closing the dialog is the caller's job; a failed save keeps it open.
  const guarded = (run: () => Promise<void>) => async () => {
    try {
      await run();
    } catch {
      /* already toasted by `send` */
    }
  };

  function renderCron(cron: CronRow) {
    const name = copy.tasks.names[cron.key];
    return (
      <TableRow key={cron.key}>
        <TableCell className="max-w-[320px]">
          <div className="flex flex-col">
            <span className="font-medium">{name}</span>
            <span className="text-xs text-muted-foreground">
              {copy.tasks.descriptions[cron.key]}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <StateBadge on={cron.enabled} label={cron.enabled ? copy.on : copy.paused} />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatCopy(copy.minutes, { n: cron.intervalMinutes })}
        </TableCell>
        <TableCell className="whitespace-nowrap">{when(cron.lastRunAt, copy.never)}</TableCell>
        <TableCell className="whitespace-nowrap">
          {cron.enabled ? when(cron.nextRunAt, copy.notScheduled) : copy.notScheduled}
        </TableCell>
        <TableCell className="max-w-[240px] text-xs">
          {cron.lastError ? (
            <span className="flex items-start gap-1 text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {cron.lastError}
            </span>
          ) : (
            (cron.lastResult ?? copy.notScheduled)
          )}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              data-e2e-id={`crons-toggle-${cron.key}`}
              disabled={busy === `cron:${cron.key}`}
              onClick={guarded(() => updateCron(cron.key, { enabled: !cron.enabled }))}
            >
              {cron.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {cron.enabled ? copy.pause : copy.resume}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-e2e-id={`crons-edit-${cron.key}`}
              onClick={() =>
                setTarget({
                  title: name,
                  value: cron.intervalMinutes,
                  min: cron.minIntervalMinutes,
                  max: cron.maxIntervalMinutes,
                  save: (minutes) => updateCron(cron.key, { intervalMinutes: minutes }),
                })
              }
            >
              <Pencil className="size-3.5" />
              {copy.edit}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  function renderStore(store: SefazPollingStore) {
    return (
      <TableRow key={store.storeId}>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{store.storeName}</span>
            <span className="text-xs text-muted-foreground">{store.organizationName}</span>
          </div>
        </TableCell>
        <TableCell>
          <StateBadge on={store.pollEnabled} label={store.pollEnabled ? copy.on : copy.paused} />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatCopy(copy.minutes, { n: store.pollIntervalMinutes })}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {when(store.nextRunAt, copy.notScheduled)}
        </TableCell>
        <TableCell className="whitespace-nowrap">{when(store.lastSyncAt, copy.never)}</TableCell>
        <TableCell className="max-w-[260px] text-xs">
          <div className="flex flex-col gap-1">
            {store.backlog ? <Badge variant="secondary">{copy.stores.backlog}</Badge> : null}
            {store.lastError ? (
              <span className="flex items-start gap-1 text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {formatCopy(copy.stores.error, { error: store.lastError })}
              </span>
            ) : !store.backlog ? (
              <span className="text-muted-foreground">{copy.stores.idle}</span>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              data-e2e-id={`crons-store-toggle-${store.storeId}`}
              disabled={busy === `store:${store.storeId}`}
              onClick={guarded(() => updateStore(store.storeId, { enabled: !store.pollEnabled }))}
            >
              {store.pollEnabled ? copy.turnOff : copy.turnOn}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-e2e-id={`crons-store-edit-${store.storeId}`}
              onClick={() =>
                setTarget({
                  title: `${store.storeName} · ${store.organizationName}`,
                  value: store.pollIntervalMinutes,
                  min: SEFAZ_POLL_MIN_MINUTES,
                  max: SEFAZ_POLL_MAX_MINUTES,
                  save: (minutes) => updateStore(store.storeId, { intervalMinutes: minutes }),
                })
              }
            >
              <Pencil className="size-3.5" />
              {copy.edit}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy.tasks.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.tasks.description}</p>
        </div>
        <DataTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.tasks.columns.task}</TableHead>
                <TableHead>{copy.tasks.columns.status}</TableHead>
                <TableHead>{copy.tasks.columns.interval}</TableHead>
                <TableHead>{copy.tasks.columns.lastRun}</TableHead>
                <TableHead>{copy.tasks.columns.nextRun}</TableHead>
                <TableHead>{copy.tasks.columns.lastResult}</TableHead>
                <TableHead className="text-right">{copy.tasks.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{overview.crons.map(renderCron)}</TableBody>
          </Table>
        </DataTableCard>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy.stores.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.stores.description}</p>
        </div>
        <DataTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.stores.columns.store}</TableHead>
                <TableHead>{copy.stores.columns.polling}</TableHead>
                <TableHead>{copy.stores.columns.interval}</TableHead>
                <TableHead>{copy.stores.columns.nextRun}</TableHead>
                <TableHead>{copy.stores.columns.lastSearch}</TableHead>
                <TableHead>{copy.stores.columns.status}</TableHead>
                <TableHead className="text-right">{copy.stores.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.stores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {copy.stores.empty}
                  </TableCell>
                </TableRow>
              ) : (
                overview.stores.map(renderStore)
              )}
            </TableBody>
          </Table>
        </DataTableCard>
      </section>

      <IntervalDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
