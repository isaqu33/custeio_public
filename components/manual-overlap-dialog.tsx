'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { formatMoney, formatQuantity } from '@/app/lib/quantity-format';
import type { NfeNoteRow } from '@/app/lib/services/nfe-documents';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * This invoice looks like purchases the owner typed in by hand ("Registrar compra"): the stock was
 * credited twice if both are real. Each one is either undone (the invoice carries it) or kept.
 */
export function ManualOverlapDialog({
  storeId,
  note,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: string;
  note: NfeNoteRow;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().invoices.overlap;
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(movementId: string, action: 'undo' | 'keep') {
    setBusy(movementId);
    try {
      await apiFetch(endpointFor(AppFeature.NFE_DOCUMENTS_RESOLVE_OVERLAP), {
        method: 'POST',
        body: { storeId, accessKey: note.accessKey, movementId, action },
        cache: 'no-store',
      });
      showSuccessToast();
      await onSaved();
      if (note.openOverlaps.length <= 1) onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.description, {
              supplier: note.supplierName,
              number: note.number ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {note.openOverlaps.map((overlap) => (
            <li key={overlap.movementId} className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                {formatCopy(copy.entry, {
                  date: day.format(new Date(overlap.occurredAt)),
                  supplier: overlap.supplierName,
                  ingredient: overlap.ingredientName,
                  quantity: formatQuantity(overlap.quantity, overlap.unit),
                  value: formatMoney(overlap.value),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void resolve(overlap.movementId, 'undo')}
                >
                  {copy.undo}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void resolve(overlap.movementId, 'keep')}
                >
                  {copy.keep}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
