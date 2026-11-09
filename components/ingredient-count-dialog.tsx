'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { displayUnit, formatQuantity, roundQuantity } from '@/app/lib/quantity-format';
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
 * "Contar estoque": the owner looked at the shelf and this is how much there is.
 * The balance becomes that number (the difference is kept in the ingredient's
 * history) and purchases add on top from here. Typed in kg/L/un, sent in g/ml/un.
 */
export function IngredientCountDialog({
  ingredient,
  open,
  onOpenChange,
  onSaved,
}: {
  ingredient: RawIngredient;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const rawCopy = useCopy().rawIngredients;
  const copy = rawCopy.countDialog;
  const { unit } = ingredient;
  // g and ml can be typed as they are stored (900 ml left in a container) or as kg/L (a big stock).
  const [bigUnit, setBigUnit] = useState(Math.abs(ingredient.currentStock) >= 1000);
  const view = unit !== 'un' && bigUnit ? displayUnit(unit) : { factor: 1, label: unit };
  const [text, setText] = useState(
    String(
      Number(
        (
          ingredient.currentStock / (unit !== 'un' && bigUnit ? displayUnit(unit).factor : 1)
        ).toFixed(3),
      ),
    ),
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const typed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(typed) && typed >= 0;
  const counted = valid ? roundQuantity(typed * view.factor) : ingredient.currentStock;
  const difference = counted - ingredient.currentStock;

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_COUNT_STOCK), {
        method: 'POST',
        body: {
          id: ingredient._id,
          countedStock: counted,
          ...(note.trim() && { note: note.trim() }),
        },
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
          <p className="text-sm text-muted-foreground">
            {formatCopy(copy.current, { value: formatQuantity(ingredient.currentStock, unit) })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="ingredient-counted">
              {formatCopy(copy.counted, { unit: view.label })}
            </Label>
            <Input
              id="ingredient-counted"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {unit !== 'un' ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline decoration-dotted"
                onClick={() => {
                  // Keep what is stored: only how it is written changes.
                  const nextFactor = bigUnit ? 1 : displayUnit(unit).factor;
                  setText(String(Number((counted / nextFactor).toFixed(3))));
                  setBigUnit(!bigUnit);
                }}
              >
                {formatCopy(rawCopy.typeIn, {
                  unit: view.label,
                  other: bigUnit ? unit : displayUnit(unit).label,
                })}
              </button>
            ) : null}
            {valid && difference !== 0 ? (
              <p
                className={`text-xs ${difference < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {formatCopy(copy.difference, {
                  value: `${difference > 0 ? '+' : ''}${formatQuantity(difference, unit)}`,
                })}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ingredient-count-note">{copy.note}</Label>
            <Input
              id="ingredient-count-note"
              maxLength={200}
              placeholder={copy.notePlaceholder}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void save()} disabled={saving || !valid} className="w-full">
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
