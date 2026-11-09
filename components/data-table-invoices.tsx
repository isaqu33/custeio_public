'use client';

import { Download } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { downloadBlob } from '@/app/lib/download-blob';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type { NfeNoteFilter, NfeNoteRow } from '@/app/lib/services/nfe-documents';
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
import { ManualOverlapDialog } from './manual-overlap-dialog';
import { TableEmptyStateRow } from './table-empty-state-row';

const FILTERS: readonly NfeNoteFilter[] = ['all', 'preview', 'full', 'cancelled'];

const STATUS_VARIANT: Record<
  NfeNoteRow['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  preview: 'outline',
  captured: 'default',
  cancelled: 'destructive',
  ignored: 'secondary',
  unprocessed: 'secondary',
};

// An NFe's issue date is the supplier's wall clock in Brazil.
const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
});
const timeOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  timeStyle: 'short',
});
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatCnpj(digits: string) {
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : digits;
}

/**
 * The invoices table, laid out like the other listings. "Dados" is what we actually hold of the
 * note: only the preview SEFAZ announced (no items, nothing in stock) or the whole note; the XML
 * can be downloaded when we kept it.
 */
export function DataTableInvoices({
  storeId,
  notes,
  total,
  totalPages,
  currentPage,
  searchTerm,
  filter,
}: {
  storeId: string;
  notes: NfeNoteRow[];
  total: number;
  totalPages: number;
  currentPage: number;
  searchTerm: string;
  filter: NfeNoteFilter;
}) {
  const appCopy = useCopy();
  const copy = appCopy.invoices;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [overlapFor, setOverlapFor] = useState<NfeNoteRow | undefined>(undefined);
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

  async function download(accessKey: string) {
    setBusy(accessKey);
    try {
      const blob = await apiFetch<Blob>(
        `${endpointFor(AppFeature.NFE_DOCUMENTS_DOWNLOAD_XML)}?${new URLSearchParams({ storeId, accessKey }).toString()}`,
        { responseType: 'blob', cache: 'no-store' },
      );
      downloadBlob(blob, `NFe${accessKey}.xml`);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.status === 404) showErrorToast(copy.downloadFailed);
      else showApiErrorToast(err);
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
        </DataTableToolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.issuedAt}</TableHead>
              <TableHead>{copy.columns.supplier}</TableHead>
              <TableHead>{copy.columns.number}</TableHead>
              <TableHead className="text-right">{copy.columns.total}</TableHead>
              <TableHead>{copy.columns.data}</TableHead>
              <TableHead>{copy.columns.status}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {notes.length === 0 ? (
              <TableEmptyStateRow
                colSpan={7}
                message={searchTerm || filter !== 'all' ? copy.noNotesFound : copy.empty}
              />
            ) : (
              notes.map((note) => (
                <TableRow key={note.accessKey}>
                  <TableCell className="text-muted-foreground">
                    <div className="flex flex-col leading-tight">
                      <span>{dateOnly.format(new Date(note.issuedAt))}</span>
                      <span className="text-xs">{timeOnly.format(new Date(note.issuedAt))}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px] whitespace-normal break-words">
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium">{note.supplierName || '—'}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatCnpj(note.supplierCnpj)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums" title={note.accessKey}>
                    {note.number ? (
                      <div className="flex flex-col leading-tight">
                        <span>{note.number}</span>
                        {note.series ? (
                          <span className="text-xs text-muted-foreground">série {note.series}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        …{note.accessKey.slice(-8)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="flex flex-col items-end leading-tight">
                      <span>{money.format(note.totalValue)}</span>
                      {note.itemsValue !== undefined && note.adjustmentsValue !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          {formatCopy(copy.itemsAndAdjustments, {
                            items: money.format(note.itemsValue),
                            adjustments: money.format(note.adjustmentsValue),
                          })}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={note.level === 'full' ? 'default' : 'outline'}
                        title={copy.levelHints[note.level]}
                      >
                        {copy.levels[note.level]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {copy.sources[note.source]}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANT[note.status]}>
                        {copy.statuses[note.status]}
                      </Badge>
                      {note.openOverlaps.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 border-amber-500 px-2 text-xs text-amber-700"
                          onClick={() => setOverlapFor(note)}
                        >
                          {copy.overlap.badge} ({note.openOverlaps.length})
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={note.hasXml ? copy.downloadXml : copy.noXml}
                      title={note.hasXml ? copy.downloadXml : copy.noXml}
                      disabled={!note.hasXml || busy !== null}
                      onClick={() => void download(note.accessKey)}
                    >
                      <Download className="size-4" />
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
        {overlapFor ? (
          <ManualOverlapDialog
            key={overlapFor.accessKey}
            storeId={storeId}
            note={notes.find((item) => item.accessKey === overlapFor.accessKey) ?? overlapFor}
            open
            onOpenChange={(open) => !open && setOverlapFor(undefined)}
            onSaved={() => router.refresh()}
          />
        ) : null}
      </DataTableCard>
    </div>
  );
}
