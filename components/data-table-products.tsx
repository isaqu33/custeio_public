'use client';

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { AlertTriangle, CloudDownload, Download } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type {
  ProductListItem,
  ProductStatusFilter,
  RecipeCopySource,
  RecipeIngredientOption,
} from '@/app/lib/services/products';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';
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
import { ProductRecipeDialog } from './product-recipe-dialog';
import { TableEmptyStateRow } from './table-empty-state-row';

type SyncStatus = {
  inProgress: boolean;
  // Whether "Sincronizar cardápio" is on hold (cooldown) and until when — decided server-side.
  sync?: { lastSyncAt?: string; nextAllowedAt?: string };
  lastCompleted?: {
    status: 'done' | 'failed';
    created?: number;
    updated?: number;
    deactivated?: number;
    error?: string;
  };
};

// While a sync runs the page checks this often whether it finished. It is one
// job and one Alloy request, so it ends within seconds — no reason to poll when idle.
const SYNC_POLL_MS = 3_000;
const CLOCK_TICK_MS = 30_000;
const STATUS_OPTIONS: readonly ProductStatusFilter[] = ['active', 'inactive', 'all'];

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function getColumns({
  onEditRecipe,
  copy: fullCopy,
}: {
  onEditRecipe: (_product: ProductListItem) => void;
  copy: AppCopy;
}): ColumnDef<ProductListItem>[] {
  const copy = fullCopy.products;

  return [
    {
      accessorKey: 'name',
      header: copy.columns.product,
      cell: ({ row }) => {
        const product = row.original;
        return (
          <div className="flex min-w-0 max-w-[420px] flex-col">
            <span className="flex items-center gap-2 font-medium">
              <span className="truncate" title={product.name}>
                {product.name}
              </span>
              {!product.isActive ? (
                <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                  {copy.inactiveBadge}
                </Badge>
              ) : null}
              {product.channel !== 'own' ? (
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {copy.channels[product.channel]}
                </Badge>
              ) : null}
              {product.promotionalPrice !== undefined ? (
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {copy.promoBadge}
                </Badge>
              ) : null}
            </span>
            {product.modifiersCount > 0 ? (
              <span className="text-xs text-muted-foreground">
                {formatCopy(copy.modifiersCount, { count: product.modifiersCount })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: 'categoryName',
      header: copy.columns.category,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.categoryName || '—'}</span>
      ),
    },
    {
      accessorKey: 'price',
      header: copy.columns.price,
      cell: ({ row }) => {
        const product = row.original;
        return (
          <span className="whitespace-nowrap">
            {product.promotionalPrice !== undefined ? (
              <span className="mr-1.5 text-xs text-muted-foreground line-through">
                {money(product.sellingPrice)}
              </span>
            ) : null}
            {money(product.price)}
          </span>
        );
      },
    },
    {
      accessorKey: 'cost',
      header: copy.columns.cost,
      cell: ({ row }) => {
        const product = row.original;
        if (product.cost === undefined) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {money(product.cost)}
            {product.costIncomplete ? (
              <span title={copy.costIncompleteHint}>
                <AlertTriangle className="size-3.5 text-chart-5" />
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: 'margin',
      header: copy.columns.margin,
      cell: ({ row }) => {
        const { margin, marginPercent } = row.original;
        if (margin === undefined) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={`whitespace-nowrap ${margin < 0 ? 'text-destructive' : ''}`}>
            {money(margin)}
            {marginPercent !== undefined ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {marginPercent.toFixed(1).replace('.', ',')}%
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'recipe',
      header: copy.columns.recipe,
      cell: ({ row }) =>
        row.original.recipe.length > 0 ? (
          <span>{formatCopy(copy.recipeItems, { count: row.original.recipe.length })}</span>
        ) : (
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {copy.noRecipe}
          </Badge>
        ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{copy.columns.actions}</div>,
      cell: ({ row }) => (
        <ActionButton
          action="edit"
          variant="outline"
          size="icon"
          iconOnly
          label={copy.editRecipe}
          onClick={() => onEditRecipe(row.original)}
        />
      ),
    },
  ];
}

export function DataTableProducts({
  storeId,
  products,
  ingredients,
  copySources,
  totalPages,
  total,
  currentPage,
  searchTerm,
  status,
}: {
  storeId: string;
  products: ProductListItem[];
  ingredients: RecipeIngredientOption[];
  copySources: RecipeCopySource[];
  totalPages: number;
  total: number;
  currentPage: number;
  searchTerm: string;
  status: ProductStatusFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy();
  const productsCopy = copy.products;

  const [editing, setEditing] = useState<ProductListItem | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The dialog reads the recipe into state once, at mount: bump on every open.
  const [dialogKey, setDialogKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wasSyncingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      try {
        const result = await apiFetch<{ done: boolean; data: SyncStatus }>(
          `${endpointFor(AppFeature.PRODUCTS_SYNC_STATUS)}?storeId=${storeId}`,
          { method: 'GET', cache: 'no-store' },
        );
        if (cancelled) return;
        setSyncStatus(result.data);
        setSyncing(result.data.inProgress);
        if (wasSyncingRef.current && !result.data.inProgress) {
          const last = result.data.lastCompleted;
          if (last?.status === 'failed') {
            showErrorToast(
              last.error
                ? formatCopy(productsCopy.sync.failedToast, { error: last.error })
                : productsCopy.sync.failedGeneric,
            );
          } else if (last?.status === 'done') {
            showSuccessToast(
              formatCopy(productsCopy.sync.doneToast, {
                created: last.created ?? 0,
                updated: last.updated ?? 0,
                deactivated: last.deactivated ?? 0,
              }),
            );
          }
          router.refresh();
        }
        wasSyncingRef.current = result.data.inProgress;
      } catch {
        // A failed poll just leaves the last known state; the next tick retries.
      }
    }

    void checkStatus();
    // Polls only while a sync is in flight; idle, one check per store is enough.
    if (!syncing) return undefined;
    const interval = setInterval(() => void checkStatus(), SYNC_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, syncing]);

  // Re-renders the cooldown label as it counts down, without polling the server.
  useEffect(() => {
    if (!syncStatus?.sync?.nextAllowedAt) return undefined;
    const interval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [syncStatus?.sync?.nextAllowedAt]);

  async function startSync() {
    setStarting(true);
    try {
      await apiFetch(endpointFor(AppFeature.PRODUCTS_SYNC_CATALOG), {
        method: 'POST',
        body: { storeId },
        cache: 'no-store',
      });
      showSuccessToast(productsCopy.sync.started);
      setSyncing(true);
      wasSyncingRef.current = true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setStarting(false);
    }
  }

  const holdMinutes = syncStatus?.sync?.nextAllowedAt
    ? Math.max(0, Math.ceil((new Date(syncStatus.sync.nextAllowedAt).getTime() - now) / 60_000))
    : 0;
  const syncLabel = syncing
    ? productsCopy.sync.syncing
    : holdMinutes > 0
      ? formatCopy(productsCopy.sync.cooldown, { minutes: holdMinutes })
      : productsCopy.sync.button;

  const columns = getColumns({
    onEditRecipe: (product) => {
      setEditing(product);
      setDialogKey((key) => key + 1);
      setDialogOpen(true);
    },
    copy,
  });
  const table = useReactTable({ data: products, columns, getCoreRowModel: getCoreRowModel() });
  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // Keeps every other param (storeId, organizationId, q, status).
  function pageHref(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  }

  function changeStatus(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'active') params.delete('status');
    else params.set('status', next);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  // The export mirrors what is on screen: same store, search and status.
  const exportParams = new URLSearchParams({ storeId, status });
  if (searchTerm) exportParams.set('q', searchTerm);
  const exportHref = `${endpointFor(AppFeature.PRODUCTS_EXPORT_CSV)}?${exportParams.toString()}`;

  return (
    <div className="w-full">
      <SearchFilter
        searchTerm={searchTerm}
        placeholderField={productsCopy.columns.product.toLowerCase()}
      />
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <div className="flex items-center gap-2">
            <ActionButton
              action="refresh"
              variant="ghost"
              iconOnly
              label={copy.common.refreshTable}
              onClick={() => {
                router.refresh();
                showSuccessToast();
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 rounded-full hover:bg-accent hover:text-accent-foreground md:size-8"
              asChild
            >
              <a
                href={exportHref}
                download
                title={productsCopy.export}
                aria-label={productsCopy.export}
              >
                <Download className="size-4" />
              </a>
            </Button>
            <Select value={status} onValueChange={changeStatus}>
              <SelectTrigger
                aria-label={productsCopy.statusFilter.label}
                className="h-8 w-[130px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {productsCopy.statusFilter[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={syncing || starting || holdMinutes > 0}
              title={
                syncStatus?.sync?.lastSyncAt
                  ? formatCopy(productsCopy.sync.lastSync, {
                      time: new Date(syncStatus.sync.lastSyncAt).toLocaleString('pt-BR'),
                    })
                  : undefined
              }
              onClick={() => void startSync()}
            >
              <CloudDownload className="mr-2 size-4" />
              {syncLabel}
            </Button>
          </div>
        </DataTableToolbar>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableEmptyStateRow
                colSpan={columns.length}
                message={
                  searchTerm || status !== 'active'
                    ? productsCopy.noProductsFound
                    : productsCopy.noProducts
                }
              />
            )}
          </TableBody>
        </Table>
        <DataTableFooter total={formatCopy(copy.common.totalItems, { count: total })}>
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

        {editing ? (
          <ProductRecipeDialog
            key={dialogKey}
            product={editing}
            ingredients={ingredients}
            copySources={copySources}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSaved={() => router.refresh()}
          />
        ) : null}
      </DataTableCard>
    </div>
  );
}
