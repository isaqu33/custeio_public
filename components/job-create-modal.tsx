'use client';

import { useState } from 'react';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';

// Ad-hoc kinds a user can start by hand. Analysis jobs are never in this list —
// those arrive from the ingestion API with a study attached.
const ADHOC_JOB_KINDS = ['users.export.csv', 'organizations.export.csv'] as const;

export function JobCreateModal() {
  const router = useRouter();
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>(ADHOC_JOB_KINDS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setIsSubmitting(true);
    setError('');
    try {
      await apiFetch(endpointFor(AppFeature.JOBS_CREATE), {
        method: 'POST',
        body: { kind },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = err.body as { error?: string; message?: string } | undefined;
        setError(payload?.error || payload?.message || copy.jobs.create.failed);
        return;
      }
      setError(err instanceof Error ? err.message : copy.jobs.create.failed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <ActionButton
          action="create"
          size="icon"
          iconOnly
          className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          title={copy.common.create}
        >
          {copy.common.create}
        </ActionButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.jobs.create.title}</DialogTitle>
          <DialogDescription>{copy.jobs.create.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue placeholder={copy.jobs.create.kindPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {ADHOC_JOB_KINDS.map((adhocKind) => (
                <SelectItem key={adhocKind} value={adhocKind}>
                  {copy.jobs.filters.kindLabels[adhocKind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {copy.common.cancel}
          </Button>
          <Button type="button" onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? copy.jobs.create.creating : copy.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
