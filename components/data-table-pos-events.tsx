'use client';

import { Braces, Copy } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { copyToClipboard } from '@/app/lib/copy-to-clipboard';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type { PosEventItem, PosEventKindFilter } from '@/app/lib/services/pos-events';
import { showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { SearchFilter } from '@/components/search-filter';
import { ActionButton } from '@/components/ui/action-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const KINDS: readonly PosEventKindFilter[] = [
  'all',
  'new_order',
  'status_change',
  'cancellation',
  'unknown',
];

const KIND_VARIANT: Record<
  PosEventItem['kind'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  new_order: 'default',
  status_change: 'secondary',
  cancellation: 'destructive',
  unknown: 'outline',
};

// Brazil's wall clock: the store's own, whatever timezone the browser is in.
const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
});
const timeOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  timeStyle: 'medium',
});
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * The PDV events table, laid out like the other listings (search card, toolbar with the
 * type filter, pagination footer). The braces action opens the delivery as it arrived —
 * customer data masked — for debugging an order with a client.
 */
export function DataTablePosEvents({
  events,
  total,
  totalPages,
  currentPage,
  searchTerm,
  kind,
}: {
  events: PosEventItem[];
  total: number;
  totalPages: number;
  currentPage: number;
  searchTerm: string;
  kind: PosEventKindFilter;
}) {
  const copy = useCopy();
  const text = copy.posEvents;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [viewing, setViewing] = useState<PosEventItem | null>(null);
  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // Keeps every other param (storeId, organizationId, q, kind).
  function pageHref(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    return `${pathname}?${params.toString()}`;
  }

  function changeKind(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('kind');
    else params.set('kind', next);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  const json = viewing ? JSON.stringify(viewing.payload ?? null, null, 2) : '';

  async function copyJson() {
    if (await copyToClipboard(json)) showSuccessToast();
    else showErrorToast(text.copyFailed);
  }

  return (
    <div className="w-full">
      <SearchFilter searchTerm={searchTerm} placeholderField={text.searchField} />
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
            <Select value={kind} onValueChange={changeKind}>
              <SelectTrigger aria-label={text.filterLabel} className="h-8 w-[170px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {text.kinds[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DataTableToolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{text.columns.receivedAt}</TableHead>
              <TableHead>{text.columns.kind}</TableHead>
              <TableHead>{text.columns.order}</TableHead>
              <TableHead>{text.columns.channel}</TableHead>
              <TableHead>{text.columns.items}</TableHead>
              <TableHead className="text-right">{text.columns.total}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableEmptyStateRow
                colSpan={7}
                message={searchTerm || kind !== 'all' ? text.noEventsFound : text.empty}
              />
            ) : (
              events.map((event) => (
                <TableRow key={event._id}>
                  <TableCell className="text-muted-foreground">
                    <div className="flex flex-col leading-tight">
                      <span>{dateOnly.format(new Date(event.receivedAt))}</span>
                      <span className="text-xs">{timeOnly.format(new Date(event.receivedAt))}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant={KIND_VARIANT[event.kind]}>{text.kinds[event.kind]}</Badge>
                        {event.demo ? <Badge variant="outline">{text.demoBadge}</Badge> : null}
                      </span>
                      {event.statusLabel ? (
                        <span className="text-xs text-muted-foreground">
                          {text.statuses[event.statusLabel as keyof typeof text.statuses] ??
                            text.statuses.other}
                          {event.statusCode !== undefined ? ` (${event.statusCode})` : ''}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {event.externalOrderId ? `#${event.externalOrderId}` : '—'}
                  </TableCell>
                  <TableCell>
                    {text.channels[event.channel as keyof typeof text.channels] ?? event.channel}
                  </TableCell>
                  <TableCell className="max-w-[340px] whitespace-normal break-words">
                    {event.items.length === 0 ? (
                      <span className="text-muted-foreground">{text.noItems}</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5 text-sm">
                        {event.items.map((item, index) => (
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
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {event.total !== undefined ? money.format(event.total) : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={text.viewJson}
                      title={text.viewJson}
                      onClick={() => setViewing(event)}
                    >
                      <Braces className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
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
      </DataTableCard>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {text.jsonTitle}
              {viewing?.externalOrderId ? ` · #${viewing.externalOrderId}` : ''}
            </DialogTitle>
            <DialogDescription>{text.jsonDescription}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-3 text-xs">
            {json}
          </pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyJson()}>
            <Copy className="mr-2 size-4" />
            {text.copyJson}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
