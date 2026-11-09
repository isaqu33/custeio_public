'use client';

import * as React from 'react';
import { Eye } from 'lucide-react';
import { apiFetch } from '@/app/lib/api-client';
import { endpointForJobDetail } from '@/app/lib/features';
import { showErrorToast } from '@/app/lib/toast';
import type { JobDetail } from '@/app/lib/types/jobs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ModalDataState } from '@/components/modal-data-state';
import { JobDetailBody } from '@/components/job-detail';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';

// How often an open modal re-reads a job that is still running. Fast enough that
// a batch landing is visible, slow enough that leaving the modal open on a
// two-hour study is not a load problem.
const LIVE_REFRESH_MS = 5_000;

// Per-row job detail modal (matches the listing-page modal pattern: no page
// navigation). Fetches the full job + conversation when opened.
export function JobDetailModal({ jobId, reference }: { jobId: string; reference: string }) {
  const copy = useCopy();
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<JobDetail | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const hasLoadedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    // Only the FIRST read shows the loading state — a refresh that blanked the
    // modal every five seconds would make a running job unreadable.
    setIsLoading((previous) => previous || !hasLoadedRef.current);
    setLoadError(null);
    try {
      const data = await apiFetch<{ done: boolean; data: JobDetail }>(endpointForJobDetail(jobId), {
        method: 'GET',
        cache: 'no-store',
      });
      if (!data.done) {
        setLoadError(copy.jobs.detail.loadFailed);
        showErrorToast();
        return;
      }
      setDetail(data.data);
      hasLoadedRef.current = true;
    } catch {
      setLoadError(copy.jobs.detail.loadFailed);
      showErrorToast();
    } finally {
      setIsLoading(false);
    }
  }, [jobId, copy]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Keep a running job's numbers moving. The elapsed clock ticks locally, but the
  // batch counter, the phase and the timings only change in the database — so the
  // modal re-fetches while the job is alive and stops the moment it is not.
  const isLive = detail ? detail.status === 'running' || detail.status === 'queued' : false;
  React.useEffect(() => {
    if (!open || !isLive) return undefined;
    const id = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [open, isLive, load]);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDetail(null);
      setLoadError(null);
      hasLoadedRef.current = false;
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.jobs.detail.view}
        >
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>
      {/* Wider than the other listing modals: the pipeline, the time breakdown
          and the projection table are three columns of numbers that a 3xl dialog
          wraps into a stack. */}
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{formatCopy(copy.jobs.detail.title, { reference })}</DialogTitle>
          <DialogDescription>{copy.jobs.detail.description}</DialogDescription>
        </DialogHeader>
        <ModalDataState
          isLoading={isLoading}
          loadingMessage={copy.jobs.detail.loading}
          errorMessage={loadError}
          hasData={Boolean(detail)}
        />
        {detail ? <JobDetailBody detail={detail} onRetried={load} /> : null}
      </DialogContent>
    </Dialog>
  );
}
