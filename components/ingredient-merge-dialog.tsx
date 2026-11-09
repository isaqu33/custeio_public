'use client';

import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CostBasis, RawIngredient } from './data-table-raw-ingredients';

/**
 * "Juntar insumos aqui": the row's ingredient is the base ("Bacon"); the ones picked here (same
 * unit) are folded into it — balance, history, invoice mappings and recipes — and deleted.
 */
export function IngredientMergeDialog({
  target,
  candidates,
  open,
  onOpenChange,
  onSaved,
}: {
  target: RawIngredient;
  candidates: RecipeIngredientOption[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().rawIngredients;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [costBasis, setCostBasis] = useState<CostBasis>('last_purchase');
  const [saving, setSaving] = useState(false);

  const sameUnit = useMemo(
    () => candidates.filter((c) => c.unit === target.unit && c._id !== target._id),
    [candidates, target],
  );
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? sameUnit.filter((c) => c.name.toLowerCase().includes(term)) : sameUnit;
  }, [sameUnit, search]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_MERGE), {
        method: 'POST',
        body: { targetId: target._id, sourceIds: [...selected], costBasis },
        cache: 'no-store',
      });
      showSuccessToast(copy.mergeDialog.done);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.mergeDialog.title}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.mergeDialog.description, { name: target.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="merge-search">{copy.mergeDialog.search}</Label>
            <Input
              id="merge-search"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {sameUnit.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {formatCopy(copy.mergeDialog.empty, { unit: target.unit })}
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {shown.map((candidate) => (
                <li key={candidate._id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      checked={selected.has(candidate._id)}
                      onCheckedChange={() => toggle(candidate._id)}
                    />
                    <span className="truncate">{candidate.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {formatCopy(copy.mergeDialog.selected, { count: selected.size })}
          </p>

          <div className="space-y-2">
            <Label>{copy.mergeDialog.costBasis}</Label>
            <Select value={costBasis} onValueChange={(value) => setCostBasis(value as CostBasis)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['last_purchase', 'average'] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {copy.costBasis[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full"
            disabled={saving || selected.size === 0}
            onClick={() => void save()}
          >
            {copy.mergeDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
