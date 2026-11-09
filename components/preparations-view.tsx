'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChefHat, ClipboardList, Pencil, Plus, Scale } from 'lucide-react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import { formatQuantity, formatUnitCost } from '@/app/lib/quantity-format';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IngredientCountDialog } from './ingredient-count-dialog';
import { IngredientBatchDialog } from './ingredient-batch-dialog';
import { IngredientPreparationDialog } from './ingredient-preparation-dialog';
import type { RawIngredient } from './data-table-raw-ingredients';

/**
 * "Preparos": what the kitchen makes itself (Molho da Casa, Maionese Defumada) — a recipe, a yield and
 * a batch each time it is made. They are ingredients like any other for the recipes of the dishes, but
 * they are not bought, so they live here instead of in the Insumos list.
 */
export function PreparationsView({
  storeId,
  preparations,
  candidates,
}: {
  storeId: string;
  preparations: RawIngredient[];
  candidates: RecipeIngredientOption[];
}) {
  const router = useRouter();
  const copy = useCopy().preparations;
  const [recipeFor, setRecipeFor] = useState<RawIngredient>();
  const [batchFor, setBatchFor] = useState<RawIngredient>();
  const [countFor, setCountFor] = useState<RawIngredient>();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState<'g' | 'ml' | 'un'>('g');
  const [creating, setCreating] = useState(false);
  const nameOf = new Map(candidates.map((c) => [c._id, c.name]));

  // A new preparation is an ingredient made in the kitchen: created here, then its recipe opens.
  async function createPreparation() {
    setCreating(true);
    try {
      const response = await apiFetch<{ data: RawIngredient }>(
        endpointFor(AppFeature.RAW_INGREDIENTS_CREATE),
        {
          method: 'POST',
          body: { storeId, name: newName.trim(), unit: newUnit, isPreparation: true },
          cache: 'no-store',
        },
      );
      setNewOpen(false);
      setNewName('');
      router.refresh();
      setRecipeFor({ ...response.data, isPreparation: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setCreating(false);
    }
  }

  const newButton = (
    <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
      <Plus className="mr-1.5 size-4" />
      {copy.newPreparation}
    </Button>
  );

  const newDialog = (
    <Dialog open={newOpen} onOpenChange={setNewOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.newTitle}</DialogTitle>
          <DialogDescription>{copy.newDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_9rem] gap-3">
          <div className="space-y-2">
            <Label htmlFor="new-preparation-name">{copy.newName}</Label>
            <Input
              id="new-preparation-name"
              autoFocus
              maxLength={100}
              placeholder={copy.newNamePlaceholder}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{copy.newUnit}</Label>
            <Select value={newUnit} onValueChange={(v) => setNewUnit(v as 'g' | 'ml' | 'un')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="g">g</SelectItem>
                <SelectItem value="ml">ml</SelectItem>
                <SelectItem value="un">un</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={creating || !newName.trim()}
            onClick={() => void createPreparation()}
          >
            {copy.newCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (preparations.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-12 text-center">
          <ChefHat className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{copy.emptyTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{copy.emptyDescription}</p>
          {newButton}
        </div>
        {newDialog}
        {recipeFor ? (
          <IngredientPreparationDialog
            key={`${recipeFor._id}-${recipeFor.preparation?.yield ?? 0}`}
            ingredient={recipeFor}
            candidates={candidates}
            open
            onOpenChange={(open) => !open && setRecipeFor(undefined)}
            onSaved={() => router.refresh()}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">{newButton}</div>
      {newDialog}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.name}</TableHead>
              <TableHead>{copy.columns.recipe}</TableHead>
              <TableHead className="text-right">{copy.columns.yield}</TableHead>
              <TableHead className="text-right">{copy.columns.stock}</TableHead>
              <TableHead className="text-right">{copy.columns.cost}</TableHead>
              <TableHead className="text-right">{copy.columns.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preparations.map((item) => {
              const unit = item.unit as 'g' | 'ml' | 'un';
              return (
                <TableRow key={item._id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="max-w-[360px] text-xs text-muted-foreground">
                    {(item.preparation?.lines ?? []).length === 0
                      ? copy.recipePending
                      : (item.preparation?.lines ?? [])
                          .map(
                            (line) =>
                              `${nameOf.get(line.rawIngredientId) ?? '—'} ${formatQuantity(line.quantity, unit)}`,
                          )
                          .join(' · ')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={copy.yieldHint}>
                    {item.preparation ? formatQuantity(item.preparation.yield, unit) : '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${item.currentStock < 0 ? 'text-destructive' : ''}`}
                    title={item.currentStock < 0 ? copy.negativeHint : undefined}
                  >
                    {formatQuantity(item.currentStock, unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUnitCost(item.averageCost, unit)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={copy.editRecipe}
                        onClick={() => setRecipeFor(item)}
                      >
                        <Pencil className="mr-1.5 size-3.5" />
                        {copy.editRecipe}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={copy.countStockHint}
                        onClick={() => setCountFor(item)}
                      >
                        <Scale className="mr-1.5 size-3.5" />
                        {copy.countStock}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title={copy.registerBatchHint}
                        disabled={!item.preparation}
                        onClick={() => setBatchFor(item)}
                      >
                        <ClipboardList className="mr-1.5 size-3.5" />
                        {copy.registerBatch}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {recipeFor ? (
        <IngredientPreparationDialog
          key={`${recipeFor._id}-${recipeFor.preparation?.yield ?? 0}`}
          ingredient={recipeFor}
          candidates={candidates}
          open
          onOpenChange={(open) => !open && setRecipeFor(undefined)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {countFor ? (
        <IngredientCountDialog
          key={countFor._id}
          ingredient={countFor}
          open
          onOpenChange={(open) => !open && setCountFor(undefined)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {batchFor ? (
        <IngredientBatchDialog
          key={batchFor._id}
          ingredient={batchFor}
          candidates={candidates}
          open
          onOpenChange={(open) => !open && setBatchFor(undefined)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
