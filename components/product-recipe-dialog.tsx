'use client';

import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type {
  ProductListItem,
  RecipeCopySource,
  RecipeIngredientOption,
} from '@/app/lib/services/products';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Line = { rawIngredientId: string; quantity: string; typed?: 'g' | 'ml' };

const money = (value: number) =>
  value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * The ficha técnica editor: how much of each ingredient goes into ONE unit of
 * the product, in the ingredient's own unit (g, ml, un). Alloy has no concept
 * of a recipe, so this is the only place it is written. Cost and margin update
 * as the lines change, from the ingredients' current average cost.
 *
 * Remounted per open (`key`) so its lines start from the saved recipe.
 */
export function ProductRecipeDialog({
  product,
  ingredients,
  copySources = [],
  open,
  onOpenChange,
  onSaved,
  save: saveRecipe,
}: {
  /** What the recipe is for: a product, or a complement shaped like one (`price` is what it sells for). */
  product: Pick<ProductListItem, '_id' | 'name' | 'price' | 'recipe'>;
  ingredients: RecipeIngredientOption[];
  /** Products that already have a recipe, to start this one from a copy (fries live in a complement). */
  copySources?: RecipeCopySource[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
  /** Overrides how the lines are saved (a complement is saved by PDV code, not by id). */
  save?: (_lines: Array<{ rawIngredientId: string; quantity: number }>) => Promise<void>;
}) {
  const copy = useCopy().products.recipeDialog;
  const [lines, setLines] = useState<Line[]>(
    product.recipe.map((line) => ({
      rawIngredientId: line.rawIngredientId,
      quantity: String(line.quantity),
    })),
  );
  const [picking, setPicking] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(ingredients.map((item) => [item._id, item])), [ingredients]);
  const used = new Set(lines.map((line) => line.rawIngredientId));
  const available = ingredients.filter((item) => !used.has(item._id));
  // Another product's recipe; the one being edited is not offered to itself.
  const sources = copySources.filter((source) => source._id !== product._id);

  // What is saved is in each ingredient's own unit, whatever unit the line was typed in.
  const quantities = lines.map((line) =>
    storedQuantity(
      Number(line.quantity.replace(',', '.')),
      line.typed,
      byId.get(line.rawIngredientId)?.unit ?? 'un',
      byId.get(line.rawIngredientId)?.gramsPerMl,
    ),
  );
  const valid = quantities.every((quantity) => Number.isFinite(quantity) && quantity > 0);
  const cost = lines.reduce(
    (sum, line, index) =>
      sum + (quantities[index] || 0) * (byId.get(line.rawIngredientId)?.averageCost ?? 0),
    0,
  );
  const margin = product.price - cost;

  function switchUnit(index: number, next: 'g' | 'ml') {
    setLines((current) =>
      current.map((line, at) => {
        const ingredient = byId.get(line.rawIngredientId);
        if (at !== index || !ingredient?.gramsPerMl) return line;
        const from = line.typed ?? ingredient.unit;
        return {
          ...line,
          typed: next === ingredient.unit ? undefined : next,
          quantity: switchedText(line.quantity, from, next, ingredient.gramsPerMl),
        };
      }),
    );
  }

  function updateQuantity(index: number, quantity: string) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, quantity } : line)));
  }

  /** Replaces the editor's lines with another product's; nothing is saved until "Salvar ficha". */
  function copyFrom(source: RecipeCopySource) {
    setLines(
      source.recipe
        .filter((line) => byId.has(line.rawIngredientId))
        .map((line) => ({
          rawIngredientId: line.rawIngredientId,
          quantity: String(line.quantity),
        })),
    );
    setCopying(false);
  }

  async function save() {
    setSaving(true);
    const payload = lines.map((line, index) => ({
      rawIngredientId: line.rawIngredientId,
      quantity: quantities[index] as number,
    }));
    try {
      if (saveRecipe) {
        await saveRecipe(payload);
      } else {
        await apiFetch(endpointFor(AppFeature.PRODUCTS_UPDATE_RECIPE), {
          method: 'POST',
          body: { id: product._id, recipe: payload },
          cache: 'no-store',
        });
      }
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
            {formatCopy(copy.description, { name: product.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {copy.empty}
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {lines.map((line, index) => {
                const ingredient = byId.get(line.rawIngredientId);
                return (
                  <li key={line.rawIngredientId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={ingredient?.name}>
                      {ingredient?.name ?? '—'}
                    </span>
                    <Input
                      aria-label={copy.quantity}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="w-28"
                      value={line.quantity}
                      onChange={(event) => updateQuantity(index, event.target.value)}
                    />
                    <RecipeUnit
                      unit={ingredient?.unit ?? ''}
                      gramsPerMl={ingredient?.gramsPerMl}
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

          {sources.length > 0 ? (
            <Popover open={copying} onOpenChange={setCopying}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="mr-2">
                  <Copy className="mr-2 size-4" />
                  {copy.copyFrom}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[320px] p-0">
                <Command>
                  <CommandInput placeholder={copy.copySearchPlaceholder} />
                  <CommandList>
                    <CommandEmpty>{copy.copyNoneFound}</CommandEmpty>
                    <CommandGroup>
                      {sources.map((source) => (
                        <CommandItem
                          key={source._id}
                          value={source.name}
                          onSelect={() => copyFrom(source)}
                        >
                          <span className="truncate">{source.name}</span>
                          <span className="ml-auto pl-2 text-xs text-muted-foreground">
                            {formatCopy(copy.copyItems, { count: source.recipe.length })}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : null}

          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={ingredients.length === 0}>
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
                    {available.map((item) => (
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
          {ingredients.length === 0 ? (
            <p className="text-xs text-muted-foreground">{copy.noIngredientsAvailable}</p>
          ) : null}

          {lines.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span>
                <span className="text-muted-foreground">{copy.estimatedCost}: </span>
                <span className="font-semibold tabular-nums">{money(cost)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">{copy.estimatedMargin}: </span>
                <span
                  className={`font-semibold tabular-nums ${margin < 0 ? 'text-destructive' : ''}`}
                >
                  {money(margin)}
                  {product.price > 0
                    ? ` (${((margin / product.price) * 100).toFixed(1).replace('.', ',')}%)`
                    : ''}
                </span>
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
