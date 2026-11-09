'use client';

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  CloudDownload,
  Download,
  FileUp,
  Merge,
  ShoppingCart,
  History,
  Scale,
  Sparkles,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { ActionButton } from '@/components/ui/action-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCopy } from '@/app/lib/i18n/client';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import type { IngredientKind, OperationState } from '@/app/lib/ingredient-naming';
import { formatMoney, formatQuantity, formatUnitCost } from '@/app/lib/quantity-format';
import type {
  IngredientGroup,
  IngredientKindFilter,
  IngredientUsageFilter,
} from '@/app/lib/services/raw-ingredients';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import type { DuplicateSuggestionItem } from '@/app/lib/services/ingredient-duplicates';
import { IngredientDuplicatesDialog } from '@/components/ingredient-duplicates-dialog';
import type { SupplierOption } from '@/app/lib/services/stock-movements';
import type { NfeSyncForecast } from '@/app/lib/jobs/nfe-sync-estimate';
import type { NfeSyncProgress } from '@/app/lib/types/jobs';
import { visiblePageWindow } from '@/app/lib/pagination';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { FilterRow, FilterShell } from '@/components/filter-shell';
import { Label } from '@/components/ui/label';
import { SearchFilter } from '@/components/search-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CaptureNfeDialog } from './capture-nfe-dialog';
import { IngredientCountDialog } from './ingredient-count-dialog';
import { IngredientMergeDialog } from './ingredient-merge-dialog';
import { IngredientHistoryDialog } from './ingredient-history-dialog';
import { NfeSyncProgressCard } from './nfe-sync-progress';
import { RawIngredientFormDialog } from './raw-ingredient-form-dialog';
import { RegisterPurchaseDialog } from './register-purchase-dialog';
import { TableEmptyStateRow } from './table-empty-state-row';

export type RawIngredientUnit = 'g' | 'ml' | 'un';
export type CostBasis = 'average' | 'last_purchase';

export type RawIngredient = {
  _id: string;
  storeId: string;
  name: string;
  unit: RawIngredientUnit;
  currentStock: number;
  averageCost: number;
  minAlertStock: number;
  isDraft: boolean;
  kind: IngredientKind;
  inOperation?: boolean;
  isPreparation: boolean;
  density?: { gramsPerMl: number; source: 'manual' | 'derived' | 'estimate' };
  familyOf?: string;
  familyName?: string;
  variantCount?: number;
  familyStock?: number;
  operation: OperationState;
  aiReview?: {
    usedByRestaurant: boolean;
    kind: IngredientKind;
    cleanName?: string;
    aliases: string[];
    pack?: { quantity: number; unit: string };
    mergeInto?: string;
    confidence: 'high' | 'medium' | 'low';
    note?: string;
    comparedWithMenu: boolean;
  };
  costBasis?: CostBasis;
  preparation?: { yield: number; lines: Array<{ rawIngredientId: string; quantity: number }> };
  /** How the team calls it, EAN/GTIN barcodes, and the pack it is bought in. */
  aliases?: string[];
  barcodes?: string[];
  purchasePack?: { label?: string; quantity: number };
  lastPurchase?: {
    at: string;
    supplierName?: string;
    supplierCnpj?: string;
    invoiceNumber?: string;
    quantity?: number;
    unitCost?: number;
  };
  pendingDelivery?: {
    accessKey: string;
    supplierName: string;
    issuedAt: string;
    totalValue: number;
  };
  usedInProducts?: number;
  createdAt: string;
};

type CaptureStatus = {
  inProgress: boolean;
  running?: { progress: NfeSyncProgress; forecast: NfeSyncForecast };
  // Whether "Buscar na SEFAZ" is on hold (cooldown / SEFAZ block / hourly limit)
  // and the moment it opens again — decided server-side, shown here.
  sync?: {
    lastSyncAt?: string;
    nextAllowedAt?: string;
    reason?: 'blocked' | 'cooldown' | 'quota';
  };
  lastCompleted?: {
    status: 'done' | 'failed';
    totalFiles?: number;
    totalItemsMatched?: number;
    totalItemsDrafted?: number;
  };
};

// How often the Stock page checks whether a capture kicked off elsewhere (or
// on a previous visit) is still running. Manual-upload batches are small and
// finish in seconds to a couple of minutes — no reason to poll slower than
// the job detail modal does for the analysis pipeline.
const CAPTURE_POLL_MS = 3_000;

const KIND_FILTERS: readonly IngredientKindFilter[] = [
  'all',
  'food',
  'packaging',
  'cleaning',
  'other',
];
const USAGE_FILTERS: readonly IngredientUsageFilter[] = ['all', 'used', 'unused'];

/** The day on the invoice, in São Paulo time: an NFe's date is a Brazilian civil date. */
function invoiceDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getColumns({
  onEdit,
  onHistory,
  onCount,
  onMerge,
  onFamily,
  selection,
  copy: fullCopy,
}: {
  onEdit: (_ingredient: RawIngredient) => void;
  onHistory: (_ingredient: RawIngredient) => void;
  onCount: (_ingredient: RawIngredient) => void;
  onMerge: (_ingredient: RawIngredient) => void;
  onFamily: (_id: string) => void;
  selection: {
    isSelected: (_id: string) => boolean;
    toggle: (_id: string) => void;
    pageState: boolean | 'indeterminate';
    togglePage: () => void;
  };
  copy: AppCopy;
}): ColumnDef<RawIngredient>[] {
  const copy = fullCopy.rawIngredients;

  return [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={selection.pageState}
          onCheckedChange={selection.togglePage}
          aria-label={copy.bulk.selectPage}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selection.isSelected(row.original._id)}
          onCheckedChange={() => selection.toggle(row.original._id)}
          aria-label={row.original.name}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: copy.columns.name,
      cell: ({ row }) => (
        <span className="flex min-w-0 max-w-[380px] items-center gap-2 font-medium">
          <span className="truncate" title={row.original.name}>
            {row.original.name}
          </span>
          {row.original.aliases?.length ? (
            <span
              className="truncate text-xs font-normal text-muted-foreground"
              title={row.original.aliases.join(', ')}
            >
              {row.original.aliases.join(', ')}
            </span>
          ) : null}
          {row.original.isDraft ? (
            <Badge
              variant="secondary"
              className="shrink-0 text-[10px] font-normal"
              title={copy.draftBadgeHint}
            >
              {copy.draftBadge}
            </Badge>
          ) : null}
          {row.original.variantCount ? (
            <button
              type="button"
              onClick={() => onFamily(row.original._id)}
              title={copy.family.badgeHint}
              className="shrink-0"
            >
              <Badge variant="secondary" className="text-[10px] font-normal">
                {row.original.variantCount === 1
                  ? copy.family.badgeOne
                  : formatCopy(copy.family.badge, { count: row.original.variantCount })}
              </Badge>
            </button>
          ) : null}
          {row.original.familyName ? (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
              {formatCopy(copy.family.variantOf, { name: row.original.familyName })}
            </Badge>
          ) : null}
          {row.original.operation === 'out' ? (
            <Badge
              variant="outline"
              className="shrink-0 text-[10px] font-normal"
              title={copy.inOperation.badgeOutHint}
            >
              {copy.inOperation.badgeOut}
            </Badge>
          ) : row.original.operation === 'unconfirmed' ? (
            <Badge
              variant="outline"
              className="shrink-0 border-amber-500/50 text-[10px] font-normal text-amber-600"
              title={row.original.aiReview?.note ?? copy.inOperation.unconfirmedHint}
            >
              {copy.inOperation.badgeUnconfirmed}
            </Badge>
          ) : row.original.aiReview ? (
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
              {copy.inOperation.badgeIn}
            </Badge>
          ) : null}
          {row.original.aiReview ? (
            <Sparkles
              className="size-3.5 shrink-0 text-amber-500"
              aria-label={copy.inOperation.aiHint}
            >
              <title>
                {row.original.aiReview.comparedWithMenu
                  ? copy.inOperation.aiHintMenu
                  : copy.inOperation.aiHint}
              </title>
            </Sparkles>
          ) : null}
          {row.original.kind !== 'food' ? (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
              {copy.kinds[row.original.kind]}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: 'currentStock',
      // The header explains what this number is: purchases minus nothing yet —
      // sales do not draw it down until pos.order.received exists.
      header: () => (
        <span className="cursor-help underline decoration-dotted" title={copy.currentStockHelp}>
          {copy.columns.currentStock}
        </span>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap">
            {formatQuantity(row.original.currentStock, row.original.unit)}
          </span>
          {row.original.familyStock !== undefined ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {formatCopy(copy.family.total, {
                quantity: formatQuantity(row.original.familyStock, row.original.unit),
              })}
            </span>
          ) : null}
          {row.original.pendingDelivery ? (
            <Badge
              variant="outline"
              className="border-amber-500 text-amber-700"
              title={formatCopy(copy.pendingDeliveryHint, {
                supplier: row.original.pendingDelivery.supplierName,
                date: invoiceDay(row.original.pendingDelivery.issuedAt),
                value: formatMoney(row.original.pendingDelivery.totalValue),
              })}
            >
              {copy.pendingDelivery}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'averageCost',
      header: copy.columns.averageCost,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatUnitCost(row.original.averageCost, row.original.unit)}
        </span>
      ),
    },
    {
      id: 'lastPurchase',
      header: copy.columns.lastPurchase,
      cell: ({ row }) => {
        const last = row.original.lastPurchase;
        if (!last) return <span className="text-muted-foreground">{copy.noLastPurchase}</span>;
        return (
          <div
            className="flex max-w-[220px] flex-col"
            title={formatCopy(copy.lastPurchaseTitle, {
              number: last.invoiceNumber ?? '—',
              supplier: last.supplierName ?? '—',
              quantity:
                last.quantity !== undefined
                  ? formatQuantity(last.quantity, row.original.unit)
                  : '—',
              cost:
                last.unitCost !== undefined
                  ? formatUnitCost(last.unitCost, row.original.unit)
                  : '—',
            })}
          >
            <span className="whitespace-nowrap">{invoiceDay(last.at)}</span>
            {last.supplierName ? (
              <span className="truncate text-xs text-muted-foreground">{last.supplierName}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'usage',
      header: copy.columns.usage,
      cell: ({ row }) =>
        row.original.usedInProducts ? (
          <span className="whitespace-nowrap">
            {formatCopy(copy.usedIn, { count: row.original.usedInProducts })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'minAlertStock',
      header: copy.columns.minAlertStock,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.original.minAlertStock > 0
            ? formatQuantity(row.original.minAlertStock, row.original.unit)
            : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{copy.columns.actions}</div>,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            title={copy.actionsHistory}
            aria-label={copy.actionsHistory}
            onClick={() => onHistory(row.original)}
          >
            <History className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            title={copy.actionsCount}
            aria-label={copy.actionsCount}
            onClick={() => onCount(row.original)}
          >
            <Scale className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            title={copy.actionsMerge}
            aria-label={copy.actionsMerge}
            onClick={() => onMerge(row.original)}
          >
            <Merge className="size-3.5" />
          </Button>
          <ActionButton
            action="edit"
            variant="outline"
            size="icon"
            iconOnly
            onClick={() => onEdit(row.original)}
          />
        </div>
      ),
    },
  ];
}

const SKELETON_COLUMNS = 7;
const SKELETON_ROWS = 5;

function CaptureLoadingRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: SKELETON_COLUMNS }).map((__, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-4 w-full max-w-32" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function DataTableRawIngredients({
  storeId,
  ingredients,
  totalPages,
  total,
  currentPage,
  searchTerm,
  kind,
  usage,
  supplier,
  group,
  family,
  showVariants,
  groupCounts,
  duplicates,
  supplierOptions,
  purchaseIngredients,
}: {
  storeId: string;
  ingredients: RawIngredient[];
  totalPages: number;
  total: number;
  currentPage: number;
  searchTerm: string;
  kind: IngredientKindFilter;
  usage: IngredientUsageFilter;
  supplier: string;
  group: IngredientGroup;
  family: string;
  showVariants: boolean;
  groupCounts: Record<IngredientGroup, number>;
  duplicates: DuplicateSuggestionItem[];
  supplierOptions: SupplierOption[];
  purchaseIngredients: RecipeIngredientOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy();
  const [formOpen, setFormOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseKey, setPurchaseKey] = useState(0);
  const [editingIngredient, setEditingIngredient] = useState<RawIngredient | undefined>(undefined);
  // RawIngredientFormDialog reads `ingredient` into useState only once, at
  // mount — bumping this on every open forces a remount so its fields never
  // carry over from whatever was last created or edited.
  const [formKey, setFormKey] = useState(0);
  // History and count read their ingredient once: a remount per open keeps them fresh.
  const [historyFor, setHistoryFor] = useState<RawIngredient | undefined>(undefined);
  const [countFor, setCountFor] = useState<RawIngredient | undefined>(undefined);
  const [mergeFor, setMergeFor] = useState<RawIngredient | undefined>(undefined);
  const [captureDialogOpen, setCaptureDialogOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Only true once a status check has actually run — otherwise the table
  // flashes the real (possibly stale) rows for a frame before the first poll
  // lands, then swaps to the skeleton.
  const [statusChecked, setStatusChecked] = useState(false);
  const wasCapturingRef = useRef(false);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      try {
        const result = await apiFetch<{ done: boolean; data: CaptureStatus }>(
          `${endpointFor(AppFeature.RAW_INGREDIENTS_CAPTURE_NFE_STATUS)}?storeId=${storeId}`,
          { method: 'GET', cache: 'no-store' },
        );
        if (cancelled) return;
        setStatus(result.data);
        setCapturing(result.data.inProgress);
        setStatusChecked(true);
        if (wasCapturingRef.current && !result.data.inProgress) {
          const summary = result.data.lastCompleted;
          if (summary?.status === 'failed') {
            showErrorToast(copy.rawIngredients.captureFailedToast);
          }
          if (summary?.status === 'done') {
            showSuccessToast(
              formatCopy(copy.rawIngredients.captureDoneToast, {
                matched: summary.totalItemsMatched ?? 0,
                drafted: summary.totalItemsDrafted ?? 0,
              }),
            );
          }
          router.refresh();
        }
        wasCapturingRef.current = result.data.inProgress;
      } catch {
        if (!cancelled) setStatusChecked(true);
      }
    }

    void checkStatus();
    const interval = setInterval(() => void checkStatus(), CAPTURE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const [reviewing, setReviewing] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  async function startAiReview() {
    setReviewing(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_AI_REVIEW), {
        method: 'POST',
        body: { storeId },
        cache: 'no-store',
      });
      showSuccessToast(copy.rawIngredients.inOperation.reviewStarted);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setReviewing(false);
    }
  }

  async function startSefazSync() {
    setStarting(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_SYNC_NFE_SEFAZ), {
        method: 'POST',
        body: { storeId },
        cache: 'no-store',
      });
      showSuccessToast(copy.rawIngredients.sync.started);
      // Flip into the running state now; the poll takes over from here.
      setCapturing(true);
      wasCapturingRef.current = true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setStarting(false);
    }
  }

  const syncHold = status?.sync?.nextAllowedAt
    ? Math.max(0, Math.ceil((new Date(status.sync.nextAllowedAt).getTime() - Date.now()) / 60_000))
    : 0;
  const syncHoldLabel =
    syncHold > 0 && status?.sync?.reason
      ? formatCopy(
          status.sync.reason === 'blocked'
            ? copy.rawIngredients.sync.blocked
            : status.sync.reason === 'quota'
              ? copy.rawIngredients.sync.quota
              : copy.rawIngredients.sync.cooldown,
          { minutes: syncHold },
        )
      : undefined;

  const openCreate = () => {
    setEditingIngredient(undefined);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  };
  const openEdit = (ingredient: RawIngredient) => {
    setEditingIngredient(ingredient);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  };

  // Row selection for "Fora / na operação" in bulk: the rows picked on this page, or — after "selecionar
  // todos" — every row of the list (all pages, same filters). It resets whenever the list changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allInList, setAllInList] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<boolean | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const listKey = `${searchParams.toString()}|${ingredients.map((i) => i._id).join(',')}`;
  useEffect(() => {
    setSelected(new Set());
    setAllInList(false);
    setPendingBulk(null);
  }, [listKey]);

  const pageIds = ingredients.map((i) => i._id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allInList ? total : selected.size;
  const selection = {
    isSelected: (id: string) => allInList || selected.has(id),
    toggle: (id: string) => {
      setAllInList(false);
      setPendingBulk(null);
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    pageState: (allInList || pageAllSelected
      ? true
      : selected.size > 0
        ? 'indeterminate'
        : false) as boolean | 'indeterminate',
    togglePage: () => {
      setAllInList(false);
      setPendingBulk(null);
      setSelected(pageAllSelected ? new Set() : new Set(pageIds));
    },
  };

  async function applyBulk(value: boolean) {
    setBulkBusy(true);
    try {
      await apiFetch(endpointFor(AppFeature.RAW_INGREDIENTS_SET_OPERATION), {
        method: 'POST',
        body: {
          storeId,
          inOperation: value,
          ...(allInList
            ? {
                filters: {
                  ...(searchTerm && { q: searchTerm }),
                  ...(kind !== 'all' && { kind }),
                  ...(usage !== 'all' && { usage }),
                  ...(supplier !== 'all' && { supplier }),
                  group,
                  ...(family && { family }),
                  ...(!family && !searchTerm && { variants: showVariants ? 'show' : 'hide' }),
                },
              }
            : { ids: [...selected] }),
        },
        cache: 'no-store',
      });
      showSuccessToast(
        formatCopy(value ? copy.rawIngredients.bulk.doneIn : copy.rawIngredients.bulk.doneOut, {
          count: selectedCount,
        }),
      );
      setSelected(new Set());
      setAllInList(false);
      setPendingBulk(null);
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setBulkBusy(false);
    }
  }

  const columns = getColumns({
    onEdit: openEdit,
    onHistory: setHistoryFor,
    onCount: setCountFor,
    onMerge: setMergeFor,
    selection,
    onFamily: (id) => setParam('family', id),
    copy,
  });

  const table = useReactTable({
    data: ingredients,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const showLoadingRows = capturing || !statusChecked;
  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // The export mirrors what is on screen: the same store and search, every page.
  const exportParams = new URLSearchParams({ storeId });
  if (searchTerm) exportParams.set('q', searchTerm);
  if (kind !== 'all') exportParams.set('kind', kind);
  if (usage !== 'all') exportParams.set('usage', usage);
  if (supplier !== 'all') exportParams.set('supplier', supplier);
  exportParams.set('group', group);
  const exportHref = `${endpointFor(AppFeature.RAW_INGREDIENTS_EXPORT_CSV)}?${exportParams.toString()}`;

  // A filter is applied on change and the page goes back to 1: the URL stays the
  // source of truth, and the search box and store picker keep their params.
  function setParam(param: 'family' | 'variants', next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(param, next);
    else params.delete(param);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  function changeFilter(param: 'kind' | 'usage' | 'supplier' | 'group', next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all' || (param === 'group' && next === 'in')) params.delete(param);
    else params.set(param, next);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  // "Limpar filtros": back to the plain listing — every filter and the search
  // term — keeping only which store/organization is selected.
  const hasActiveFilters =
    kind !== 'all' || usage !== 'all' || supplier !== 'all' || Boolean(searchTerm);
  function resetFilters() {
    const params = new URLSearchParams();
    const store = searchParams.get('storeId');
    const organizationId = searchParams.get('organizationId');
    if (store) params.set('storeId', store);
    if (organizationId) params.set('organizationId', organizationId);
    router.push(`${pathname}?${params.toString()}`);
  }

  // Keeps every other param (storeId, organizationId, q) — the store picker and
  // the search box share this URL, so a page link must not drop them.
  function pageHref(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="w-full">
      <SearchFilter
        searchTerm={searchTerm}
        placeholderField={copy.rawIngredients.columns.name.toLowerCase()}
      />
      {/* Narrowing the list (page-level filtering) belongs in its own card, not
          crammed into the table's toolbar alongside the row-scoped actions —
          see docs/design/data-tables.md. Each select still applies the moment
          it is picked; only "Limpar filtros" is a separate click. */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist">
        {(['in', 'out', 'review'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            role="tab"
            aria-selected={group === value}
            size="sm"
            variant={group === value ? 'default' : 'outline'}
            title={copy.rawIngredients.groups[`${value}Hint`]}
            onClick={() => changeFilter('group', value)}
          >
            {copy.rawIngredients.groups[value]}
            <span className="ml-2 text-xs opacity-70">{groupCounts[value]}</span>
          </Button>
        ))}
        {family ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-pressed={showVariants}
            onClick={() => setParam('variants', showVariants ? null : 'show')}
          >
            {showVariants
              ? copy.rawIngredients.family.hideVariants
              : copy.rawIngredients.family.showVariants}
          </Button>
        )}
      </div>
      {family ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {formatCopy(copy.rawIngredients.family.onlyFamily, {
            name: ingredients.find((item) => item._id === family)?.name ?? '',
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setParam('family', null)}
          >
            {copy.rawIngredients.family.clearFamily}
          </Button>
        </div>
      ) : null}
      <FilterShell>
        <FilterRow>
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label
                className="cursor-help text-xs font-medium uppercase tracking-wider text-muted-foreground underline decoration-dotted"
                title={copy.rawIngredients.kindFilterHint}
              >
                {copy.rawIngredients.kinds.label}
              </Label>
              <Select value={kind} onValueChange={(next) => changeFilter('kind', next)}>
                <SelectTrigger aria-label={copy.rawIngredients.kinds.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {copy.rawIngredients.kinds[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label
                className="cursor-help text-xs font-medium uppercase tracking-wider text-muted-foreground underline decoration-dotted"
                title={copy.rawIngredients.usageFilter.hint}
              >
                {copy.rawIngredients.usageFilter.label}
              </Label>
              <Select value={usage} onValueChange={(next) => changeFilter('usage', next)}>
                <SelectTrigger aria-label={copy.rawIngredients.usageFilter.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USAGE_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {copy.rawIngredients.usageFilter[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label
                className="cursor-help text-xs font-medium uppercase tracking-wider text-muted-foreground underline decoration-dotted"
                title={copy.rawIngredients.supplierFilter.hint}
              >
                {copy.rawIngredients.supplierFilter.label}
              </Label>
              <Select value={supplier} onValueChange={(next) => changeFilter('supplier', next)}>
                <SelectTrigger aria-label={copy.rawIngredients.supplierFilter.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{copy.rawIngredients.supplierFilter.all}</SelectItem>
                  {supplierOptions.map((option) => (
                    <SelectItem key={option.cnpj} value={option.cnpj}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ActionButton
            action="clear"
            variant="outline"
            size="icon"
            iconOnly
            label={copy.rawIngredients.resetFilters}
            disabled={!hasActiveFilters}
            onClick={resetFilters}
          />
        </FilterRow>
      </FilterShell>
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <div className="flex items-center gap-1">
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
                title={copy.rawIngredients.export}
                aria-label={copy.rawIngredients.export}
              >
                <Download className="size-4" />
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={capturing || starting || Boolean(syncHoldLabel)}
              title={
                status?.sync?.lastSyncAt
                  ? formatCopy(copy.rawIngredients.sync.lastSync, {
                      time: new Date(status.sync.lastSyncAt).toLocaleString('pt-BR'),
                    })
                  : undefined
              }
              onClick={() => void startSefazSync()}
            >
              <CloudDownload className="mr-2 size-4" />
              {syncHoldLabel ?? copy.rawIngredients.sync.button}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reviewing}
              title={copy.rawIngredients.inOperation.reviewHint}
              onClick={() => void startAiReview()}
            >
              <Sparkles className="mr-2 size-4" />
              {copy.rawIngredients.inOperation.reviewButton}
            </Button>
            {duplicates.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDuplicatesOpen(true)}
              >
                <Merge className="mr-2 size-4" />
                {copy.rawIngredients.duplicates.button}
                <span className="ml-2 text-xs opacity-70">{duplicates.length}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={capturing}
              onClick={() => setCaptureDialogOpen(true)}
            >
              <FileUp className="mr-2 size-4" />
              {capturing ? copy.rawIngredients.capturing : copy.rawIngredients.captureNfe}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPurchaseKey((key) => key + 1);
                setPurchaseOpen(true);
              }}
            >
              <ShoppingCart className="mr-2 size-4" />
              {copy.rawIngredients.purchaseDialog.button}
            </Button>
            <ActionButton
              action="create"
              size="icon"
              iconOnly
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              label={copy.rawIngredients.add}
              onClick={openCreate}
            />
          </div>
        </DataTableToolbar>
        {capturing && status?.running ? (
          <div className="px-4 pb-3">
            <NfeSyncProgressCard
              progress={status.running.progress}
              forecast={status.running.forecast}
            />
          </div>
        ) : null}
        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-2 text-sm">
            <span className="font-medium">
              {formatCopy(copy.rawIngredients.bulk.selected, { count: selectedCount })}
            </span>
            {!allInList && pageAllSelected && total > pageIds.length ? (
              <Button type="button" variant="link" size="sm" onClick={() => setAllInList(true)}>
                {formatCopy(copy.rawIngredients.bulk.selectAll, { total })}
              </Button>
            ) : null}
            <span className="flex-1" />
            {([false, true] as const).map((value) =>
              pendingBulk === value ? (
                <Button
                  key={String(value)}
                  type="button"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => void applyBulk(value)}
                >
                  {formatCopy(
                    value
                      ? copy.rawIngredients.bulk.confirmIn
                      : copy.rawIngredients.bulk.confirmOut,
                    { count: selectedCount },
                  )}
                </Button>
              ) : (
                <Button
                  key={String(value)}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => setPendingBulk(value)}
                >
                  {value ? copy.rawIngredients.bulk.markIn : copy.rawIngredients.bulk.markOut}
                </Button>
              ),
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
                setAllInList(false);
                setPendingBulk(null);
              }}
            >
              {copy.rawIngredients.bulk.clear}
            </Button>
          </div>
        ) : null}
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
            {showLoadingRows ? (
              <CaptureLoadingRows />
            ) : table.getRowModel().rows?.length ? (
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
                  searchTerm
                    ? copy.rawIngredients.noIngredientsFound
                    : copy.rawIngredients.noIngredients
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

        <RawIngredientFormDialog
          key={`form-${formKey}`}
          storeId={storeId}
          ingredient={editingIngredient}
          mainOptions={purchaseIngredients}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={() => router.refresh()}
        />

        {historyFor ? (
          <IngredientHistoryDialog
            ingredient={historyFor}
            open
            onOpenChange={(open) => !open && setHistoryFor(undefined)}
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

        <IngredientDuplicatesDialog
          suggestions={duplicates}
          open={duplicatesOpen}
          onOpenChange={setDuplicatesOpen}
          onChanged={() => router.refresh()}
        />

        {mergeFor ? (
          <IngredientMergeDialog
            key={mergeFor._id}
            target={mergeFor}
            candidates={purchaseIngredients}
            open
            onOpenChange={(open) => !open && setMergeFor(undefined)}
            onSaved={() => router.refresh()}
          />
        ) : null}

        <RegisterPurchaseDialog
          key={`purchase-${purchaseKey}`}
          storeId={storeId}
          ingredients={purchaseIngredients}
          supplierNames={supplierOptions.map((option) => option.name)}
          open={purchaseOpen}
          onOpenChange={setPurchaseOpen}
          onSaved={() => router.refresh()}
        />

        <CaptureNfeDialog
          storeId={storeId}
          open={captureDialogOpen}
          onOpenChange={setCaptureDialogOpen}
          onStarted={() => {
            setCapturing(true);
            wasCapturingRef.current = true;
          }}
        />
      </DataTableCard>
    </div>
  );
}
