'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { formatQuantity, formatUnitCost } from '@/app/lib/quantity-format';
import type { MovementListItem } from '@/app/lib/services/stock-movements';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RawIngredient } from './data-table-raw-ingredients';

/** The day on the invoice, in São Paulo time: an NFe's date is a Brazilian civil date. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Where an ingredient's balance came from: every purchase (invoice, supplier,
 * date, quantity, landed unit cost and how the price moved from the previous
 * purchase) and every adjustment (count or manual edit, with the balance before
 * and after). Loaded when the dialog opens.
 */
export function IngredientHistoryDialog({
  ingredient,
  open,
  onOpenChange,
}: {
  ingredient: RawIngredient;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}) {
  const copy = useCopy().rawIngredients.historyDialog;
  const [items, setItems] = useState<MovementListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    // Mounted fresh for each ingredient (the table remounts it), so it starts empty.
    let cancelled = false;
    apiFetch<{ done: boolean; data: MovementListItem[] }>(
      `${endpointFor(AppFeature.RAW_INGREDIENTS_GET_MOVEMENTS)}?ingredientId=${ingredient._id}`,
      { method: 'GET', cache: 'no-store' },
    )
      .then((result) => !cancelled && setItems(result.data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, ingredient._id]);

  const { unit } = ingredient;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{formatCopy(copy.title, { name: ingredient.name })}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-destructive">{copy.loadFailed}</p>
        ) : items === null ? (
          <div className="space-y-2" aria-label={copy.loading}>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {copy.empty}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.columns.date}</TableHead>
                <TableHead>{copy.columns.type}</TableHead>
                <TableHead>{copy.columns.origin}</TableHead>
                <TableHead>{copy.columns.quantity}</TableHead>
                <TableHead>{copy.columns.unitCost}</TableHead>
                <TableHead>{copy.columns.change}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item._id}>
                  <TableCell className="whitespace-nowrap">{day(item.occurredAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {copy.types[item.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {item.type === 'purchase' || item.type === 'reversal' ? (
                      <div className="flex flex-col">
                        <span className="truncate font-medium" title={item.supplierName}>
                          {item.supplierName}
                        </span>
                        {item.invoiceNumber ? (
                          <span className="text-xs text-muted-foreground">
                            {formatCopy(copy.invoice, { number: item.invoiceNumber })}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {item.type === 'internal_use' ? (
                          <span className="font-medium">
                            {[
                              item.personName,
                              item.reason
                                ? (copy.reasons as Record<string, string>)[item.reason]
                                : undefined,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                        {item.note ? <span>{item.note}</span> : null}
                        {item.balanceBefore !== undefined && item.balanceAfter !== undefined ? (
                          <span className="text-xs text-muted-foreground">
                            {formatCopy(copy.balance, {
                              before: formatQuantity(item.balanceBefore, unit),
                              after: formatQuantity(item.balanceAfter, unit),
                            })}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap ${item.quantity < 0 ? 'text-destructive' : ''}`}
                  >
                    {item.quantity > 0 ? '+' : ''}
                    {formatQuantity(item.quantity, unit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.unitCost !== undefined ? formatUnitCost(item.unitCost, unit) : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.priceChangePercent === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          item.priceChangePercent > 0 ? 'text-destructive' : 'text-emerald-500'
                        }
                      >
                        {item.priceChangePercent > 0 ? '+' : ''}
                        {item.priceChangePercent.toFixed(1).replace('.', ',')}%
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
