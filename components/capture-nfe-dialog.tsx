'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp, X } from 'lucide-react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import { cn } from '@/app/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Node's global `btoa` only handles Latin1 — this walks the bytes instead,
 * same approach the rest of the codebase's binary-to-base64 spots use. */
function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!);
  return btoa(binary);
}

/**
 * Manual-upload NFe capture — see docs/features/sefaz-nfe.md. Reads each
 * file client-side (no separate blob storage for this first version; the job
 * payload carries the content directly, see app/lib/jobs/types.ts) — as text
 * for an XML, base64 for a DANFE PDF (sniffed by extension, not MIME, since a
 * dropped file's `type` is unreliable) — and enqueues `sefaz.nfe.received`.
 * `onStarted` lets the caller flip into the "capturing" loading state without
 * waiting for the job to actually finish.
 */
export function CaptureNfeDialog({
  storeId,
  open,
  onOpenChange,
  onStarted,
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onStarted: () => void;
}) {
  const copy = useCopy().rawIngredients.capture;
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const byName = new Map(prev.map((file) => [file.name, file]));
      accepted.forEach((file) => byName.set(file.name, file));
      return [...byName.values()].slice(0, 20);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/xml': ['.xml'],
      'application/xml': ['.xml'],
      'application/pdf': ['.pdf'],
    },
    // A DANFE PDF runs larger than the XML it prints — 2 MB covers the
    // text-based ones this parses; matches the ~2.8 MB base64 cap the API
    // validates against (captureNfeInvoices, app/lib/validations.ts).
    maxSize: 2 * 1024 * 1024,
    maxFiles: 20,
    multiple: true,
  });

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((file) => file.name !== name));
  }

  async function handleSubmit() {
    if (files.length === 0) return;
    setIsSubmitting(true);
    try {
      const uploadFiles = await Promise.all(
        files.map(async (file) =>
          file.name.toLowerCase().endsWith('.pdf')
            ? {
                fileName: file.name,
                content: bytesToBase64(await file.arrayBuffer()),
                encoding: 'base64' as const,
              }
            : { fileName: file.name, content: await file.text() },
        ),
      );
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_CAPTURE_NFE), {
        method: 'POST',
        body: { storeId, files: uploadFiles },
        cache: 'no-store',
      });
      setFiles([]);
      onOpenChange(false);
      onStarted();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50',
          )}
        >
          <input {...getInputProps()} />
          <FileUp className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{copy.dropHint}</p>
          <p className="text-xs text-muted-foreground/70">{copy.dropHintSecondary}</p>
        </div>

        {files.length > 0 ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs"
              >
                <span className="truncate font-mono">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(file.name)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={copy.remove}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || files.length === 0}
            className="w-full"
          >
            {isSubmitting ? copy.submitting : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
