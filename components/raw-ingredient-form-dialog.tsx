'use client';

import { useState } from 'react';
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
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { Sparkles } from 'lucide-react';
import {
  INGREDIENT_KINDS,
  type IngredientKind,
  type OperationState,
} from '@/app/lib/ingredient-naming';
import { formatCopy } from '@/app/lib/i18n/format';
import { displayUnit, roundQuantity } from '@/app/lib/quantity-format';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import type { CostBasis, RawIngredientUnit, RawIngredient } from './data-table-raw-ingredients';

const NO_FAMILY = 'none';

const UNITS: readonly RawIngredientUnit[] = ['g', 'ml', 'un'];

/**
 * The quantity and the cost are shown and typed in the unit people read (kg, L,
 * un) while the ingredient is stored in g, ml, un: 5 kg is 5000 g, R$ 2,50/kg is
 * R$ 0,0025/g. The form's state stays in STORAGE units, so switching the unit
 * dropdown never silently changes a number, only how it is written.
 */
function shown(value: number, factor: number, perUnit = false): string {
  const converted = perUnit ? value * factor : value / factor;
  return String(Number(converted.toFixed(6)));
}

/** Add a new ingredient to a store, or edit an existing one. Stock and cost are a
 * manual baseline: every captured invoice rolls them forward from there, and a
 * change to the balance made here is kept in the ingredient's history. */
export function RawIngredientFormDialog({
  storeId,
  ingredient,
  mainOptions = [],
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: string;
  ingredient?: RawIngredient;
  /** Ingredients it may be grouped under (the server refuses the invalid ones). */
  mainOptions?: RecipeIngredientOption[];
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().rawIngredients;
  const isEdit = Boolean(ingredient);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState<RawIngredientUnit>(ingredient?.unit ?? 'un');
  const [kind, setKind] = useState<IngredientKind>(ingredient?.kind ?? 'food');
  // undefined: follow the kind. Only sent on an edit, and only once someone clicks the button.
  const [inOperation, setInOperation] = useState<boolean | undefined>(ingredient?.inOperation);
  const initialDensity = ingredient?.density ? String(ingredient.density.gramsPerMl) : '';
  const [densityText, setDensityText] = useState(initialDensity);
  const [familyOf, setFamilyOf] = useState(ingredient?.familyOf ?? NO_FAMILY);
  const [isPreparation, setIsPreparation] = useState(ingredient?.isPreparation ?? false);
  const [costBasis, setCostBasis] = useState<CostBasis>(ingredient?.costBasis ?? 'average');
  // Storage units, as numbers: what is displayed is derived from these on every render.
  const [currentStock, setCurrentStock] = useState(ingredient?.currentStock ?? 0);
  const [averageCost, setAverageCost] = useState(ingredient?.averageCost ?? 0);
  const [minAlertStock, setMinAlertStock] = useState(ingredient?.minAlertStock ?? 0);
  // Nicknames and barcodes are typed as comma-separated text; the pack quantity is in STORAGE units
  // like the other quantities (what is displayed is derived from it).
  const [aliasesText, setAliasesText] = useState((ingredient?.aliases ?? []).join(', '));
  const [barcodesText, setBarcodesText] = useState((ingredient?.barcodes ?? []).join(', '));
  const [packName, setPackName] = useState(ingredient?.purchasePack?.label ?? '');
  const [packQuantity, setPackQuantity] = useState(ingredient?.purchasePack?.quantity ?? 0);

  const review = ingredient?.aiReview;
  // What the owner just chose wins; otherwise where the ingredient stands now (see `operationState`).
  const state: OperationState =
    inOperation === undefined ? (ingredient?.operation ?? 'in') : inOperation ? 'in' : 'out';
  const operationText =
    state === 'in'
      ? copy.inOperation.statusIn
      : state === 'out'
        ? copy.inOperation.statusOut
        : copy.inOperation.statusUnconfirmed;
  // Fills the form with what the AI proposed; nothing is saved until the owner saves. A pack the AI
  // read in another unit than the ingredient's (400 g on an item stocked in "un") is not applied.
  function applySuggestion() {
    if (!review) return;
    if (review.cleanName) setName(review.cleanName);
    setKind(review.kind);
    if (review.aliases.length) setAliasesText(review.aliases.join(', '));
    if (review.pack && review.pack.unit === unit) setPackQuantity(review.pack.quantity);
  }

  // g and ml can be typed as kg and L (big amounts) or as they are stored (a 150 ml bottle). It opens
  // in the stored unit unless something already stored is in the thousands; the choice is the owner's.
  const [bigUnit, setBigUnit] = useState(
    Math.max(currentStock, minAlertStock, packQuantity) >= 1000,
  );
  const view = unit !== 'un' && bigUnit ? displayUnit(unit) : { factor: 1, label: unit };
  const { factor } = view;
  const label = view.label;
  const fromShown = (value: number) => roundQuantity(value * factor);
  // A cleared or half-typed field ("", "1,") is 0 rather than NaN, like before.
  const parse = (text: string) => Number(text.replace(',', '.')) || 0;

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const splitList = (text: string) =>
        text
          .split(/[,;\n]/)
          .map((part) => part.trim())
          .filter(Boolean);
      const pack =
        packQuantity > 0 ? { label: packName.trim() || undefined, quantity: packQuantity } : null;
      const body = {
        name: name.trim(),
        unit,
        kind,
        currentStock,
        averageCost,
        minAlertStock,
        aliases: splitList(aliasesText),
        barcodes: splitList(barcodesText),
        // On an edit `null` takes the pack away; on a new ingredient there is nothing to take.
        purchasePack: isEdit ? pack : (pack ?? undefined),
      };
      if (isEdit && ingredient) {
        await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_UPDATE), {
          method: 'POST',
          body: {
            id: ingredient._id,
            ...body,
            costBasis,
            inOperation,
            isPreparation,
            familyOf: familyOf === NO_FAMILY ? null : familyOf,
            // Only what the owner changed: an untouched, calculated density stays as it is.
            ...(densityText !== initialDensity && {
              gramsPerMl: parse(densityText) > 0 ? parse(densityText) : null,
            }),
          },
          cache: 'no-store',
        });
      } else {
        await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_CREATE), {
          method: 'POST',
          body: { storeId, ...body },
          cache: 'no-store',
        });
      }
      showSuccessToast();
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err, {
        CONFLICT: /barcode/i.test(err.message) ? copy.duplicateBarcode : copy.duplicateName,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? copy.editTitle : copy.addTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? copy.editDescription : copy.addDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ingredient-name">{copy.nameRequired}</Label>
            <Input
              id="ingredient-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{copy.unitRequired}</Label>
              <Select value={unit} onValueChange={(value) => setUnit(value as RawIngredientUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {copy.unitLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {unit !== 'un' ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline decoration-dotted"
                  onClick={() => setBigUnit(!bigUnit)}
                >
                  {formatCopy(copy.typeIn, {
                    unit: label,
                    other: bigUnit ? unit : displayUnit(unit).label,
                  })}
                </button>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>{copy.kindLabel}</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as IngredientKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INGREDIENT_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {copy.kinds[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{copy.kindHint}</p>
          {isEdit ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{copy.preparationToggle.title}</p>
                <p>{isPreparation ? copy.preparationToggle.on : copy.preparationToggle.off}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPreparation(!isPreparation)}
              >
                {isPreparation ? copy.preparationToggle.unmark : copy.preparationToggle.mark}
              </Button>
            </div>
          ) : null}
          {isEdit && review ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5 text-amber-500" />
                  {copy.inOperation.suggestTitle} · {copy.inOperation.confidence[review.confidence]}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={applySuggestion}>
                  {copy.inOperation.suggestApply}
                </Button>
              </div>
              {review.note ? <p className="text-muted-foreground">{review.note}</p> : null}
              {review.cleanName ? (
                <p>
                  {copy.inOperation.suggestTitle}: <strong>{review.cleanName}</strong> ·{' '}
                  {copy.kinds[review.kind]}
                </p>
              ) : null}
              {review.mergeInto ? (
                <p className="text-muted-foreground">
                  {formatCopy(copy.inOperation.suggestMerge, { name: review.mergeInto })}
                </p>
              ) : null}
              {review.pack && review.pack.unit !== unit ? (
                <p className="text-muted-foreground">
                  {formatCopy(copy.inOperation.suggestPackSkipped, {
                    quantity: String(review.pack.quantity),
                    unit: review.pack.unit,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          {isEdit ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{operationText}</p>
                {review && state !== 'in' && !review.usedByRestaurant ? (
                  <p>
                    {formatCopy(copy.inOperation.aiSaysNot, {
                      confidence: copy.inOperation.confidence[review.confidence],
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {state !== 'in' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInOperation(true)}
                  >
                    {copy.inOperation.markIn}
                  </Button>
                ) : null}
                {state !== 'out' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInOperation(false)}
                  >
                    {copy.inOperation.markOut}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="ingredient-current-stock">
              {formatCopy(copy.currentStockOptional, { unit: label })}
            </Label>
            <Input
              id="ingredient-current-stock"
              type="number"
              step="any"
              value={shown(currentStock, factor)}
              onChange={(e) => setCurrentStock(fromShown(parse(e.target.value)))}
            />
            <p className="text-xs text-muted-foreground">{copy.currentStockHint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ingredient-average-cost">
              {formatCopy(copy.averageCostOptional, { unit: label })}
            </Label>
            <Input
              id="ingredient-average-cost"
              type="number"
              min={0}
              step="0.01"
              value={shown(averageCost, factor, true)}
              onChange={(e) => setAverageCost(parse(e.target.value) / factor)}
            />
            <p className="text-xs text-muted-foreground">{copy.averageCostHint}</p>
          </div>

          {isEdit ? (
            <div className="space-y-2">
              <Label>{copy.costBasisLabel}</Label>
              <Select value={costBasis} onValueChange={(value) => setCostBasis(value as CostBasis)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['average', 'last_purchase'] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {copy.costBasis[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{copy.costBasisHint}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="ingredient-min-alert-stock">
              {formatCopy(copy.minAlertStockOptional, { unit: label })}
            </Label>
            <Input
              id="ingredient-min-alert-stock"
              type="number"
              min={0}
              step="any"
              value={shown(minAlertStock, factor)}
              onChange={(e) => setMinAlertStock(fromShown(parse(e.target.value)))}
            />
            <p className="text-xs text-muted-foreground">{copy.minAlertStockHint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ingredient-aliases">{copy.aliasesLabel}</Label>
            <Input
              id="ingredient-aliases"
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              placeholder={copy.aliasesPlaceholder}
            />
            <p className="text-xs text-muted-foreground">{copy.aliasesHint}</p>
          </div>

          {isEdit && unit !== 'un' ? (
            <div className="space-y-2">
              <Label htmlFor="ingredient-density">{copy.density.label}</Label>
              <Input
                id="ingredient-density"
                type="number"
                min={0}
                step="any"
                value={densityText}
                placeholder="1,15"
                onChange={(e) => setDensityText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {ingredient?.density && densityText === initialDensity
                  ? copy.density[ingredient.density.source]
                  : copy.density.hint}
              </p>
            </div>
          ) : null}

          {isEdit ? (
            <div className="space-y-2">
              <Label>{copy.family.label}</Label>
              <Select value={familyOf} onValueChange={setFamilyOf}>
                <SelectTrigger aria-label={copy.family.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FAMILY}>{copy.family.none}</SelectItem>
                  {mainOptions
                    .filter((option) => option._id !== ingredient?._id)
                    .map((option) => (
                      <SelectItem key={option._id} value={option._id}>
                        {option.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{copy.family.hint}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="ingredient-barcodes">{copy.barcodesLabel}</Label>
            <Input
              id="ingredient-barcodes"
              inputMode="numeric"
              value={barcodesText}
              onChange={(e) => setBarcodesText(e.target.value)}
              placeholder={copy.barcodesPlaceholder}
            />
            <p className="text-xs text-muted-foreground">{copy.barcodesHint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ingredient-pack-quantity">{copy.packLabelTitle}</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label={copy.packLabelTitle}
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                placeholder={copy.packNamePlaceholder}
                maxLength={40}
              />
              <Input
                id="ingredient-pack-quantity"
                aria-label={formatCopy(copy.packQuantity, { unit: label })}
                type="number"
                min={0}
                step="any"
                placeholder={formatCopy(copy.packQuantity, { unit: label })}
                value={packQuantity > 0 ? shown(packQuantity, factor) : ''}
                onChange={(e) => setPackQuantity(fromShown(parse(e.target.value)))}
              />
            </div>
            <p className="text-xs text-muted-foreground">{copy.packHint}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => void handleSave()}
            disabled={isLoading || !name.trim()}
            className="w-full"
          >
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
