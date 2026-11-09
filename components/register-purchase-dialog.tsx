'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { displayUnit, fromDisplayQuantity, roundCost } from '@/app/lib/quantity-format';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { Button } from '@/components/ui/button';
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

type Line = { rawIngredientId: string; quantity: string; unitCost: string };

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toNumber = (text: string) => Number(text.replace(',', '.'));
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, the browser's day

/**
 * "Registrar compra": the owner types in a purchase whose note the app cannot capture. Quantity and
 * cost are typed in what people read (kg, L, un) and sent in the stock unit (g, ml, un). The cost
 * starts at the ingredient's current average cost, so a repeat purchase only needs the quantity.
 * Remounted per open (`key`) so each entry gets its own request id and starts empty.
 */
export function RegisterPurchaseDialog({
  storeId,
  ingredients,
  supplierNames,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: string;
  ingredients: RecipeIngredientOption[];
  supplierNames: string[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().rawIngredients.purchaseDialog;
  // One id per opening of the dialog: a double click or a retry cannot credit the stock twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(ingredients.map((item) => [item._id, item])), [ingredients]);
  const used = new Set(lines.map((line) => line.rawIngredientId));
  const available = ingredients.filter((item) => !used.has(item._id));

  const parsed = lines.map((line) => ({
    quantity: toNumber(line.quantity),
    unitCost: toNumber(line.unitCost),
  }));
  const total = parsed.reduce(
    (sum, line) =>
      sum + (Number.isFinite(line.quantity * line.unitCost) ? line.quantity * line.unitCost : 0),
    0,
  );
  const valid =
    supplier.trim() !== '' &&
    date !== '' &&
    lines.length > 0 &&
    parsed.every(
      (line) =>
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isFinite(line.unitCost) &&
        line.unitCost >= 0,
    );

  function addIngredient(item: RecipeIngredientOption) {
    // Cost per DISPLAY unit (R$/kg), from the stock-unit average cost (R$/g).
    const perDisplay = item.averageCost * displayUnit(item.unit).factor;
    setLines((current) => [
      ...current,
      {
        rawIngredientId: item._id,
        quantity: '',
        unitCost: perDisplay > 0 ? String(Number(perDisplay.toFixed(4))) : '',
      },
    ]);
  }

  function update(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_REGISTER_PURCHASE), {
        method: 'POST',
        body: {
          storeId,
          requestId,
          supplierName: supplier.trim(),
          occurredAt: new Date(`${date}T12:00:00`).toISOString(),
          ...(note.trim() && { note: note.trim() }),
          lines: lines.map((line, index) => {
            const unit = byId.get(line.rawIngredientId)?.unit ?? 'un';
            const factor = displayUnit(unit).factor;
            return {
              rawIngredientId: line.rawIngredientId,
              quantity: fromDisplayQuantity(parsed[index]?.quantity ?? 0, unit),
              unitCost: roundCost((parsed[index]?.unitCost ?? 0) / factor),
            };
          }),
        },
        cache: 'no-store',
      });
      showSuccessToast(formatCopy(copy.saved, { count: lines.length, total: money(total) }));
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="purchase-supplier">{copy.supplier}</Label>
              <Input
                id="purchase-supplier"
                list="purchase-suppliers"
                value={supplier}
                placeholder={copy.supplierPlaceholder}
                onChange={(event) => setSupplier(event.target.value)}
              />
              <datalist id="purchase-suppliers">
                {supplierNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purchase-date">{copy.date}</Label>
              <Input
                id="purchase-date"
                type="date"
                value={date}
                max={today()}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purchase-note">{copy.note}</Label>
            <Input
              id="purchase-note"
              value={note}
              maxLength={200}
              placeholder={copy.notePlaceholder}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{copy.lines}</Label>
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                {copy.empty}
              </p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {lines.map((line, index) => {
                  const ingredient = byId.get(line.rawIngredientId);
                  const unit = displayUnit(ingredient?.unit ?? 'un').label;
                  const lineTotal = (parsed[index]?.quantity ?? 0) * (parsed[index]?.unitCost ?? 0);
                  return (
                    <li key={line.rawIngredientId} className="flex flex-wrap items-center gap-2">
                      <span
                        className="min-w-0 flex-1 basis-40 truncate text-sm"
                        title={ingredient?.name}
                      >
                        {ingredient?.name ?? '—'}
                      </span>
                      <Input
                        aria-label={`${copy.quantity} (${unit})`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className="w-24"
                        placeholder={unit}
                        value={line.quantity}
                        onChange={(event) => update(index, { quantity: event.target.value })}
                      />
                      <Input
                        aria-label={formatCopy(copy.unitCost, { unit })}
                        title={formatCopy(copy.unitCost, { unit })}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className="w-28"
                        placeholder={`R$/${unit}`}
                        value={line.unitCost}
                        onChange={(event) => update(index, { unitCost: event.target.value })}
                      />
                      <span className="w-24 text-right text-sm tabular-nums">
                        {Number.isFinite(lineTotal) ? money(lineTotal) : '—'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={copy.remove}
                        title={copy.remove}
                        onClick={() =>
                          setLines((current) => current.filter((_, at) => at !== index))
                        }
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
              <PopoverContent align="start" className="w-[340px] p-0">
                <Command>
                  <CommandInput placeholder={copy.searchPlaceholder} />
                  <CommandList>
                    <CommandEmpty>{copy.noIngredientFound}</CommandEmpty>
                    <CommandGroup>
                      {available.map((item) => (
                        <CommandItem
                          key={item._id}
                          value={[item.name, ...item.aliases, ...item.barcodes].join(' ')}
                          onSelect={() => {
                            addIngredient(item);
                            setPicking(false);
                          }}
                        >
                          <Check className="mr-2 size-4 opacity-0" />
                          <span className="truncate">{item.name}</span>
                          <span className="ml-auto pl-2 text-xs text-muted-foreground">
                            {displayUnit(item.unit).label}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {lines.length > 0 ? (
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{copy.total}</span>
              <span className="font-semibold tabular-nums">{money(total)}</span>
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
