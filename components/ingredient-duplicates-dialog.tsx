'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { formatQuantity, formatUnitCost } from '@/app/lib/quantity-format';
import type {
  DuplicateMember,
  DuplicateSuggestionItem,
} from '@/app/lib/services/ingredient-duplicates';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Unit = DuplicateMember['unit'];
const asUnit = (unit: Unit) => unit as 'g' | 'ml' | 'un';

/**
 * "Possíveis duplicados": what the AI found to be the same ingredient under other names. Each card
 * says what stays, what is folded into it and what the balance and cost become; "Juntar" asks once
 * more before merging (it deletes the others), "Ignorar" is remembered. The groups that need a unit
 * conversion first are shown, without the button.
 */
export function IngredientDuplicatesDialog({
  suggestions,
  open,
  onOpenChange,
  onChanged,
}: {
  suggestions: DuplicateSuggestionItem[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const copy = useCopy().rawIngredients.duplicates;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>, doneMessage: string) {
    setBusy(id);
    try {
      await action();
      showSuccessToast(doneMessage);
      setConfirming(null);
      await onChanged();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setBusy(null);
    }
  }

  const merge = (item: DuplicateSuggestionItem) =>
    run(
      item._id,
      () =>
        apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_MERGE), {
          method: 'POST',
          body: {
            targetId: item.keep._id,
            sourceIds: item.merge.map((m) => m._id),
            costBasis: 'average',
          },
          cache: 'no-store',
        }).then(() => undefined),
      copy.merged,
    );

  const dismiss = (item: DuplicateSuggestionItem) =>
    run(
      item._id,
      () =>
        apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_DUPLICATES_DISMISS), {
          method: 'POST',
          body: { id: item._id },
          cache: 'no-store',
        }).then(() => undefined),
      copy.dismissed,
    );

  const line = (member: DuplicateMember) => (
    <span className="tabular-nums text-muted-foreground">
      {formatQuantity(member.currentStock, asUnit(member.unit))} ·{' '}
      {formatUnitCost(member.averageCost, asUnit(member.unit))}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-500" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="space-y-3">
            {suggestions.map((item) => (
              <li key={item._id} className="space-y-2 rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {copy.keeps} <strong>{item.keep.name}</strong>
                    </p>
                    <p className="text-xs">{line(item.keep)}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                    {copy.confidence[item.confidence]}
                  </Badge>
                </div>
                <ul className="space-y-0.5 border-l pl-3">
                  {item.merge.map((member) => (
                    <li key={member._id} className="flex flex-wrap items-center gap-x-2 text-xs">
                      <span>← {member.name}</span>
                      {line(member)}
                    </li>
                  ))}
                </ul>
                {item.reason ? (
                  <p className="text-xs text-muted-foreground">{item.reason}</p>
                ) : null}
                {item.convertFirst ? (
                  <p className="text-xs text-amber-600">
                    {formatCopy(copy.convertFirst, { why: item.convertFirst })}
                  </p>
                ) : item.after ? (
                  <p className="text-xs">
                    {formatCopy(copy.after, {
                      stock: formatQuantity(item.after.currentStock, asUnit(item.keep.unit)),
                      cost: formatUnitCost(item.after.averageCost, asUnit(item.keep.unit)),
                    })}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy === item._id}
                    onClick={() => void dismiss(item)}
                  >
                    {copy.dismiss}
                  </Button>
                  {item.convertFirst ? null : confirming === item._id ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === item._id}
                      onClick={() => void merge(item)}
                    >
                      {formatCopy(copy.confirm, { count: item.merge.length })}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirming(item._id)}
                    >
                      {copy.merge}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
