'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import {
  displayUnit,
  formatUnitCost,
  fromDisplayQuantity,
  toDisplayQuantity,
} from '@/app/lib/quantity-format';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { storedQuantity, switchedText } from '@/app/lib/density';
import { Button } from '@/components/ui/button';
import { RecipeUnit } from './recipe-unit';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { RawIngredient } from './data-table-raw-ingredients';

type Line = { rawIngredientId: string; quantity: string; typed?: 'g' | 'ml' };

/**
 * "Preparo": what ONE batch of something the kitchen makes ("Molho da Casa") takes and how much it
 * yields. Lines are typed in each ingredient's own unit (g, ml, un), the yield in the preparation's
 * display unit (kg, L, un). Leaving it empty removes the preparation. Remounted per open.
 */
export function IngredientPreparationDialog({
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
  const copy = useCopy().rawIngredients.preparationDialog;
  const { unit } = ingredient;
  const unitLabel = displayUnit(unit).label;
  const options = useMemo(
    () => candidates.filter((item) => item._id !== ingredient._id),
    [candidates, ingredient._id],
  );
  const byId = useMemo(() => new Map(options.map((item) => [item._id, item])), [options]);
  const [yieldText, setYieldText] = useState(
    ingredient.preparation
      ? String(Number(toDisplayQuantity(ingredient.preparation.yield, unit).toFixed(3)))
      : '',
  );
  const [lines, setLines] = useState<Line[]>(
    (ingredient.preparation?.lines ?? []).map((line) => ({
      rawIngredientId: line.rawIngredientId,
      quantity: String(line.quantity),
    })),
  );
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const num = (text: string) => Number(text.replace(',', '.'));
  const yieldValue = num(yieldText);
  // What is saved is in each ingredient's own unit, whatever unit the line was typed in.
  const quantities = lines.map((line) =>
    storedQuantity(
      num(line.quantity),
      line.typed,
      byId.get(line.rawIngredientId)?.unit ?? 'un',
      byId.get(line.rawIngredientId)?.gramsPerMl,
    ),
  );
  const clearing = lines.length === 0 && yieldText.trim() === '';
  const valid =
    clearing ||
    (Number.isFinite(yieldValue) &&
      yieldValue > 0 &&
      lines.length > 0 &&
      quantities.every((q) => Number.isFinite(q) && q > 0));
  const cost = lines.reduce(
    (sum, line, i) =>
      sum + (quantities[i] || 0) * (byId.get(line.rawIngredientId)?.averageCost ?? 0),
    0,
  );
  const yieldStock = Number.isFinite(yieldValue) ? fromDisplayQuantity(yieldValue, unit) : 0;
  const used = new Set(lines.map((line) => line.rawIngredientId));

  function switchUnit(index: number, next: 'g' | 'ml') {
    setLines((current) =>
      current.map((line, at) => {
        const item = byId.get(line.rawIngredientId);
        if (at !== index || !item?.gramsPerMl) return line;
        const from = line.typed ?? item.unit;
        return {
          ...line,
          typed: next === item.unit ? undefined : next,
          quantity: switchedText(line.quantity, from, next, item.gramsPerMl),
        };
      }),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_SAVE_PREPARATION), {
        method: 'POST',
        body: {
          id: ingredient._id,
          yield: clearing ? 0 : yieldStock,
          lines: clearing
            ? []
            : lines.map((line, i) => ({
                rawIngredientId: line.rawIngredientId,
                quantity: quantities[i],
              })),
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.description, { name: ingredient.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="preparation-yield">{formatCopy(copy.yield, { unit: unitLabel })}</Label>
            <Input
              id="preparation-yield"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={yieldText}
              onChange={(event) => setYieldText(event.target.value)}
            />
          </div>

          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {copy.empty}
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {lines.map((line, index) => {
                const item = byId.get(line.rawIngredientId);
                return (
                  <li key={line.rawIngredientId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={item?.name}>
                      {item?.name ?? '—'}
                    </span>
                    <Input
                      aria-label={copy.quantity}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="w-28"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((l, at) =>
                            at === index ? { ...l, quantity: event.target.value } : l,
                          ),
                        )
                      }
                    />
                    <RecipeUnit
                      unit={item?.unit ?? ''}
                      gramsPerMl={item?.gramsPerMl}
                      typed={line.typed}
                      onSwitch={(next) => switchUnit(index, next)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={copy.remove}
                      title={copy.remove}
                      onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Plus className="mr-2 size-4" />
                {copy.addIngredient}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-0">
              <Command>
                <CommandInput placeholder={copy.searchPlaceholder} />
                <CommandList>
                  <CommandEmpty>{copy.noIngredientFound}</CommandEmpty>
                  <CommandGroup>
                    {options
                      .filter((item) => !used.has(item._id))
                      .map((item) => (
                        <CommandItem
                          key={item._id}
                          value={[item.name, ...item.aliases, ...item.barcodes].join(' ')}
                          onSelect={() => {
                            setLines((current) => [
                              ...current,
                              { rawIngredientId: item._id, quantity: '' },
                            ]);
                            setPicking(false);
                          }}
                        >
                          <Check className="mr-2 size-4 opacity-0" />
                          <span className="truncate">{item.name}</span>
                          <span className="ml-auto pl-2 text-xs text-muted-foreground">
                            {item.unit}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {lines.length > 0 && yieldStock > 0 ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{copy.costPerUnit}: </span>
              <span className="font-semibold tabular-nums">
                {formatUnitCost(cost / yieldStock, unit)}
              </span>
            </div>
          ) : null}
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
