'use client';

import { RefreshCw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type { OrderListItem, OrderStockFilter } from '@/app/lib/services/orders';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
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
import { TableEmptyStateRow } from './table-empty-state-row';

const FILTERS: readonly OrderStockFilter[] = [
  'all',
  'incomplete',
  'debited',
  'pending',
  'reversed',
];

const STATUS_VARIANT: Record<
  OrderListItem['stockStatus'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = { pending: 'outline', debited: 'default', reversed: 'secondary' };

// Brazil's wall clock: the store's own, whatever timezone the browser is in.
const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
});
const timeOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  timeStyle: 'short',
});
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

/**
 * The orders table, laid out like the other listings. An order settled with a product or complement
 * that had no recipe shows how many are missing, and its cost is marked as a floor; "Reprocessar"
 * settles it again against the recipes as they are now.
 */
export function DataTableOrders({
  storeId,
  orders,
  total,
  totalPages,
  currentPage,
  searchTerm,
  filter,
  incompleteCount,
}: {
  storeId: string;
  orders: OrderListItem[];
  total: number;
  totalPages: number;
  currentPage: number;
  searchTerm: string;
  filter: OrderStockFilter;
  incompleteCount: number;
}) {
  const appCopy = useCopy();
  const copy = appCopy.orders;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // Keeps every other param (storeId, organizationId, q, filter).
  function pageHref(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  }

  function changeFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('filter');
    else params.set('filter', next);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  async function reprocess(externalOrderId?: string) {
    setBusy(externalOrderId ?? 'all');
    try {
      await apiFetch(endpointFor(AppFeature.ORDERS_REPROCESS), {
        method: 'POST',
        body: { storeId, ...(externalOrderId && { externalOrderId }) },
        cache: 'no-store',
      });
      showSuccessToast(externalOrderId ? copy.reprocessed : copy.reprocessStarted);
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full">
      <SearchFilter searchTerm={searchTerm} placeholderField={copy.searchField} />
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <div className="flex items-center gap-2">
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
            <Select value={filter} onValueChange={changeFilter}>
              <SelectTrigger aria-label={copy.filterLabel} className="h-8 w-[170px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {copy.filters[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || incompleteCount === 0}
            onClick={() => void reprocess()}
          >
            <RefreshCw className="mr-2 size-4" />
            {copy.reprocessAll}
          </Button>
        </DataTableToolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.placedAt}</TableHead>
              <TableHead>{copy.columns.order}</TableHead>
              <TableHead>{copy.columns.channel}</TableHead>
              <TableHead>{copy.columns.items}</TableHead>
              <TableHead className="text-right">{copy.columns.total}</TableHead>
              <TableHead className="text-right">{copy.columns.cost}</TableHead>
              <TableHead>{copy.columns.stock}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableEmptyStateRow
                colSpan={8}
                message={searchTerm || filter !== 'all' ? copy.noOrdersFound : copy.empty}
              />
            ) : (
              orders.map((order) => {
                const missing = order.incompleteLines;
                return (
                  <TableRow key={order._id}>
                    <TableCell className="text-muted-foreground">
                      {order.placedAt ? (
                        <div className="flex flex-col leading-tight">
                          <span>{dateOnly.format(new Date(order.placedAt))}</span>
                          <span className="text-xs">
                            {timeOnly.format(new Date(order.placedAt))}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="font-medium">#{order.externalOrderId}</TableCell>
                    <TableCell>
                      {copy.channels[order.channel as keyof typeof copy.channels] ?? order.channel}
                    </TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal break-words">
                      <ul className="flex flex-col gap-0.5 text-sm">
                        {order.items.map((item, index) => (
                          <li key={index}>
                            {item.quantity}x {item.name}
                            {item.modifiers.length > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {' '}
                                + {item.modifiers.join(', ')}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money.format(order.totalValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {order.stockStatus === 'debited' ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span
                            title={
                              missing.length > 0
                                ? formatCopy(copy.costFloor, {
                                    names: missing.map((m) => m.name).join(', '),
                                  })
                                : undefined
                            }
                          >
                            {missing.length > 0 ? '≥ ' : ''}
                            {money.format(order.calculatedCost)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {percent.format(order.profitMargin)}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={STATUS_VARIANT[order.stockStatus]}>
                          {copy.stockStatuses[order.stockStatus]}
                        </Badge>
                        {order.stockStatus === 'debited' ? (
                          missing.length > 0 ? (
                            <Badge
                              variant="destructive"
                              title={missing.map((m) => m.name).join(', ')}
                            >
                              {formatCopy(copy.incompleteBadge, { count: missing.length })}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {copy.completeBadge}
                            </span>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {order.stockStatus === 'debited' && missing.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={copy.reprocess}
                          title={copy.reprocess}
                          disabled={busy !== null}
                          onClick={() => void reprocess(order.externalOrderId)}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
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
    </div>
  );
}
