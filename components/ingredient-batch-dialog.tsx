'use client';

import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import {
  displayUnit,
  formatMoney,
  formatQuantity,
  formatUnitCost,
  fromDisplayQuantity,
  toDisplayQuantity,
} from '@/app/lib/quantity-format';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
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
import type { RawIngredient } from './data-table-raw-ingredients';

/**
 * "Registrar lote": the kitchen made some of a preparation. Shows what it will take out of stock
 * and what the batch costs before confirming. The request id makes a double click count once.
 */
export function IngredientBatchDialog({
  ingredient,
  candidates,
  open,
  onOpenChange,
  onSaved,
}: {
  ingredient: RawIngredient;
  candidates: RecipeIngredientOption[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().rawIngredients.batchDialog;
  const { unit } = ingredient;
  const recipe = ingredient.preparation;
  const [requestId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState(
    recipe ? String(Number(toDisplayQuantity(recipe.yield, unit).toFixed(3))) : '',
  );
  const [saving, setSaving] = useState(false);
  const byId = useMemo(() => new Map(candidates.map((item) => [item._id, item])), [candidates]);

  const typed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(typed) && typed > 0;
  const produced = valid ? fromDisplayQuantity(typed, unit) : 0;
  const factor = recipe && produced > 0 ? produced / recipe.yield : 0;
  const rows = (recipe?.lines ?? []).map((line) => {
    const item = byId.get(line.rawIngredientId);
    return {
      id: line.rawIngredientId,
      name: item?.name ?? '—',
      unit: item?.unit ?? 'g',
      quantity: line.quantity * factor,
      cost: line.quantity * factor * (item?.averageCost ?? 0),
      priced: (item?.averageCost ?? 0) > 0,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const unpriced = rows.filter((row) => !row.priced).length;

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_REGISTER_BATCH), {
        method: 'POST',
        body: { id: ingredient._id, producedQuantity: produced, requestId },
        cache: 'no-store',
      });
      showSuccessToast();
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.description, { name: ingredient.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batch-produced">
              {formatCopy(copy.produced, { unit: displayUnit(unit).label })}
            </Label>
            <Input
              id="batch-produced"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          {valid ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{copy.willUse}</p>
              <ul className="space-y-1">
                {rows.map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span className="truncate">{row.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatQuantity(row.quantity, row.unit)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">{copy.cost}: </span>
                <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  ({formatUnitCost(total / produced, unit)})
                </span>
              </div>
              {unpriced > 0 ? (
                <p className="text-xs text-destructive">
                  {formatCopy(copy.unpriced, { count: unpriced })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={() => void save()} disabled={saving || !valid} className="w-full">
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
