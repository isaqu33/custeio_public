'use client';

import { Pencil } from 'lucide-react';
import { showSuccessToast } from '@/app/lib/toast';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type { ModifierListItem } from '@/app/lib/services/modifiers';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { SearchFilter } from '@/components/search-filter';
import { ActionButton } from '@/components/ui/action-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProductRecipeDialog } from './product-recipe-dialog';
import { TableEmptyStateRow } from './table-empty-state-row';

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * The complements of a store (one row per PDV code) and their ficha técnica. The recipe
 * dialog is the same one products use; it is saved by code, so one save covers the
 * complement under every product that offers it.
 */
export function ModifiersTable({
  storeId,
  modifiers,
  ingredients,
  total,
  totalPages,
  currentPage,
  searchTerm,
}: {
  storeId: string;
  modifiers: ModifierListItem[];
  ingredients: RecipeIngredientOption[];
  total: number;
  totalPages: number;
  currentPage: number;
  searchTerm: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const appCopy = useCopy();
  const copy = appCopy.modifiers;
  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // Keeps every other param (storeId, organizationId, q).
  function pageHref(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  }
  const [editing, setEditing] = useState<ModifierListItem | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);

  function edit(modifier: ModifierListItem) {
    setEditing(modifier);
    setDialogKey((key) => key + 1);
    setOpen(true);
  }

  return (
    <div className="w-full">
      <SearchFilter searchTerm={searchTerm} placeholderField={copy.searchField} />
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <ActionButton
            action="refresh"
            variant="ghost"
            iconOnly
            label={appCopy.common.refreshTable}
            onClick={() => {
              router.refresh();
              showSuccessToast();
            }}
          />
        </DataTableToolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.modifier}</TableHead>
              <TableHead>{copy.columns.groups}</TableHead>
              <TableHead>{copy.columns.price}</TableHead>
              <TableHead>{copy.columns.products}</TableHead>
              <TableHead>{copy.columns.recipe}</TableHead>
              <TableHead>{copy.columns.cost}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {modifiers.length === 0 ? (
              <TableEmptyStateRow colSpan={7} message={copy.empty} />
            ) : (
              modifiers.map((modifier) => (
                <TableRow key={modifier.codPdv}>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-col whitespace-normal break-words">
                      <span className="font-medium">{modifier.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatCopy(copy.code, { code: modifier.codPdv })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] whitespace-normal break-words text-muted-foreground">
                    {modifier.groups.join(', ') || '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {modifier.priceMax === 0
                      ? '—'
                      : modifier.priceMin === modifier.priceMax
                        ? money(modifier.priceMax)
                        : `${money(modifier.priceMin)} – ${money(modifier.priceMax)}`}
                  </TableCell>
                  <TableCell>{modifier.productsCount}</TableCell>
                  <TableCell className="max-w-[260px] whitespace-normal break-words">
                    {!modifier.configured ? (
                      <Badge variant="outline">{copy.noRecipe}</Badge>
                    ) : modifier.recipe.length === 0 ? (
                      <Badge variant="secondary">{copy.consumesNothing}</Badge>
                    ) : (
                      <span className="text-sm">
                        {modifier.recipe
                          .map((line) => `${line.quantity} ${line.unit} ${line.name}`)
                          .join(' · ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {modifier.cost !== undefined ? money(modifier.cost) : '—'}
                    {modifier.costIncomplete ? ' *' : ''}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={copy.edit}
                      title={copy.edit}
                      onClick={() => edit(modifier)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <DataTableFooter total={formatCopy(appCopy.common.totalItems, { count: total })}>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href={currentPage > 1 ? pageHref(currentPage - 1) : undefined}
                />
              </PaginationItem>
              {visiblePages.map((page, index) => (
                <PaginationItem key={index}>
                  {page === '...' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      isActive={page === currentPage}
                      href={page === currentPage ? undefined : pageHref(Number(page))}
                    >
                      {page}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href={currentPage < totalPages ? pageHref(currentPage + 1) : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </DataTableFooter>
      </DataTableCard>

      {editing ? (
        <ProductRecipeDialog
          key={dialogKey}
          product={{
            _id: editing.codPdv,
            name: editing.name,
            price: editing.priceMax,
            recipe: editing.recipe,
          }}
          ingredients={ingredients}
          open={open}
          onOpenChange={setOpen}
          onSaved={() => router.refresh()}
          save={async (recipe) => {
            await apiFetch(endpointFor(AppFeature.PRODUCTS_UPDATE_MODIFIER_RECIPE), {
              method: 'POST',
              body: { storeId, codPdv: editing.codPdv, recipe },
              cache: 'no-store',
            });
          }}
        />
      ) : null}
    </div>
  );
}
