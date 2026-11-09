'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { displayUnit, formatMoney, fromDisplayQuantity } from '@/app/lib/quantity-format';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const USE_REASONS = ['employee', 'courtesy', 'donation', 'other'] as const;
const WASTE_REASONS = ['expired', 'breakage', 'receiving_damage', 'other'] as const;
type Reason = (typeof USE_REASONS)[number] | (typeof WASTE_REASONS)[number];

/** `use`: Consumo interno (who took it); `waste`: Avaria (lost, no person). */
export type OutflowMode = 'use' | 'waste';

type Line = { ingredientId: string; text: string };

const toNumber = (text: string) => Number(text.replace(',', '.'));

/**
 * "Registrar consumo interno": something left the stock with no sale. Shows what it is worth at
 * cost before confirming. The request id makes a double click count once; the caller mounts a
 * fresh dialog per opening, so each entry gets its own.
 */
export function InternalUseDialog({
  mode = 'use',
  storeId,
  options,
  people,
  open,
  onOpenChange,
  onSaved,
}: {
  mode?: OutflowMode;
  storeId: string;
  options: RecipeIngredientOption[];
  people: string[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().internalUse;
  const waste = mode === 'waste';
  const text = { ...copy.dialog, ...(waste ? copy.waste.dialog : {}) };
  const reasons: readonly Reason[] = waste ? WASTE_REASONS : USE_REASONS;
  const reasonLabels = (waste ? copy.waste.reasons : copy.reasons) as Record<string, string>;
  const [requestId] = useState(() => crypto.randomUUID());
  const [personName, setPersonName] = useState('');
  const [reason, setReason] = useState<Reason>(waste ? 'expired' : 'employee');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const byId = useMemo(() => new Map(options.map((item) => [item._id, item])), [options]);
  const used = new Set(lines.map((line) => line.ingredientId));

  const rows = lines.map((line) => {
    const item = byId.get(line.ingredientId);
    const typed = toNumber(line.text);
    const valid = line.text.trim() !== '' && Number.isFinite(typed) && typed > 0 && Boolean(item);
    const quantity = valid && item ? fromDisplayQuantity(typed, item.unit) : 0;
    return { line, item, valid, quantity, cost: quantity * (item?.averageCost ?? 0) };
  });
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const unpriced = rows.filter((row) => row.valid && (row.item?.averageCost ?? 0) <= 0).length;
  const needsPerson = !waste && reason === 'employee' && personName.trim() === '';
  const canSave = rows.length > 0 && rows.every((row) => row.valid) && !needsPerson && !saving;

  async function save() {
    setSaving(true);
    try {
      const feature = waste
        ? AppFeature.RAW_INGREDIENTS_REGISTER_WASTE
        : AppFeature.RAW_INGREDIENTS_REGISTER_INTERNAL_USE;
      await apiFetch(endpointFor(feature), {
        method: 'POST',
        body: {
          storeId,
          requestId,
          reason,
          personName: waste ? undefined : personName.trim() || undefined,
          note: note.trim() || undefined,
          lines: rows.map((row) => ({
            rawIngredientId: row.line.ingredientId,
            quantity: row.quantity,
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
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="internal-use-reason">{text.reason}</Label>
              <Select value={reason} onValueChange={(value) => setReason(value as Reason)}>
                <SelectTrigger id="internal-use-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((value) => (
                    <SelectItem key={value} value={value}>
                      {reasonLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {waste ? null : (
              <div className="space-y-2">
                <Label htmlFor="internal-use-person">{text.person}</Label>
                <Input
                  id="internal-use-person"
                  list="internal-use-people"
                  maxLength={80}
                  autoComplete="off"
                  placeholder={text.personPlaceholder}
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                />
                <datalist id="internal-use-people">
                  {people.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                {needsPerson ? (
                  <p className="text-xs text-muted-foreground">{text.personRequired}</p>
                ) : null}
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {text.empty}
            </p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {rows.map((row, index) => (
                <li key={row.line.ingredientId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={row.item?.name}>
                    {row.item?.name ?? '—'}
                  </span>
                  <Input
                    aria-label={text.quantity}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    className="w-28"
                    value={row.line.text}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((l, at) =>
                          at === index ? { ...l, text: event.target.value } : l,
                        ),
                      )
                    }
                  />
                  <span className="w-8 text-xs text-muted-foreground">
                    {row.item ? displayUnit(row.item.unit).label : ''}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={text.remove}
                    title={text.remove}
                    onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Plus className="mr-2 size-4" />
                {text.addIngredient}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-0">
              <Command>
                <CommandInput placeholder={text.searchPlaceholder} />
                <CommandList>
                  <CommandEmpty>{text.noIngredientFound}</CommandEmpty>
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
                              { ingredientId: item._id, text: '' },
                            ]);
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

          <div className="space-y-2">
            <Label htmlFor="internal-use-note">{text.note}</Label>
            <Input
              id="internal-use-note"
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {rows.length > 0 ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{text.total}: </span>
              <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
              {unpriced > 0 ? (
                <p className="mt-1 text-xs text-destructive">
                  {formatCopy(text.unpriced, { count: unpriced })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={() => void save()} disabled={!canSave} className="w-full">
            {text.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
