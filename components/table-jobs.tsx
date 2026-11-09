'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { formatDateShort, formatTimeShort } from '@/app/lib/date-format';
import { BriefcaseBusiness, Download, Loader2 } from 'lucide-react';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { visiblePageWindow } from '@/app/lib/pagination';
import { apiFetch } from '@/app/lib/api-client';
import { downloadBlob } from '@/app/lib/download-blob';
import { showErrorToast, showSuccessToast } from '@/app/lib/toast';

import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { FilterActions, FilterRow, FilterShell } from '@/components/filter-shell';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { Label } from '@/components/ui/label';
import { formatCopy } from '@/app/lib/i18n/format';
import { useFilterDraft } from '@/hooks/use-filter-draft';
import { JobCreateModal } from './job-create-modal';
import { JobDetailModal } from './job-detail-modal';
import { endpointForJobDownload } from '@/app/lib/features';
import { SYSTEM_ONLY_JOB_KINDS } from '@/app/lib/jobs/system-only-kinds';
import { useCopy } from '@/app/lib/i18n/client';

// Every kind the filter offers, in one place: a kind added to the registry and
// missing here used to be invisible in the filter even though rows for it existed.
const FILTERABLE_JOB_KINDS = [
  'users.export.csv',
  'organizations.export.csv',
  'sefaz.nfe.received',
  'pos.catalog.sync',
  'pos.order.received',
  'pos.orders.reprocess',
  'ai.ingredients.review',
  'cron.sefaz.auto-sync',
  'cron.queue.cleanup',
] as const;
// Kinds whose result is a CSV the user downloads rather than a pipeline to
// inspect. They are all System/Support only — see `app/lib/jobs/system-only-kinds.ts`.
const REPORT_JOB_KINDS = SYSTEM_ONLY_JOB_KINDS;

export type Job = {
  _id: string;
  examId: string;
  organizationId: string;
  kind?: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  createdAt: string;
  result?: {
    csvBase64?: string;
    fileName?: string;
    mimeType?: string;
    container?: string;
    blobPath?: string;
  };
};

export function DataTableJobs({
  jobs,
  totalPages,
  total,
  currentPage,
  searchTerm,
  searchType,
  jobKind,
  dateFrom,
  dateTo,
  canManageSystemJobs = false,
}: {
  jobs: Job[];
  totalPages: number;
  total: number;
  currentPage: number;
  searchTerm: string;
  searchType: string;
  jobKind: string;
  dateFrom: string;
  dateTo: string;
  // Resolved on the server. Controls the platform-report controls only — the
  // rows themselves are already filtered by the service, and the routes refuse
  // the request regardless of what this hides.
  canManageSystemJobs?: boolean;
}) {
  const visibleJobKinds = canManageSystemJobs
    ? FILTERABLE_JOB_KINDS
    : FILTERABLE_JOB_KINDS.filter((kind) => !REPORT_JOB_KINDS.includes(kind));

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  // The URL owns the applied filters; this is the copy the user is editing.
  const { draft, setField } = useFilterDraft({
    textSearch: searchTerm || '',
    selectedSearchType: searchType || 'examId',
    selectedKind: jobKind || 'all',
    fromDate: dateFrom || '',
    toDate: dateTo || '',
  });
  const { textSearch, selectedSearchType, selectedKind, fromDate, toDate } = draft;
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy();

  const columns: ColumnDef<Job>[] = [
    {
      accessorKey: 'examId',
      header: copy.jobs.columns.examId,
      cell: ({ row }) => <span className="font-medium">{row.original.examId}</span>,
    },
    {
      accessorKey: 'kind',
      header: copy.jobs.columns.kind,
      // The raw job kind (`analysis.process.received`) stays as-is: it is the
      // identifier support quotes back, not prose.
      cell: ({ row }) => (
        <span className="capitalize">{row.original.kind || row.original.type || '-'}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: copy.jobs.columns.status,
      // `first-letter:uppercase` instead of `capitalize`: the dictionary stores
      // statuses lowercase, and `capitalize` title-cases every word — fine for
      // one-word English statuses, wrong for the multi-word ones other languages
      // need, which would come out with each word capitalized.
      cell: ({ row }) => (
        <span className="first-letter:uppercase">{copy.jobStatus[row.original.status]}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: copy.jobs.columns.createdAt,
      cell: ({ row }) => {
        const formattedDate = formatDateShort(row.original.createdAt);
        const formattedTime = formatTimeShort(row.original.createdAt);
        if (formattedDate === '-') return <span>-</span>;
        return (
          <div className="flex flex-col">
            <span suppressHydrationWarning>{formattedDate}</span>
            <span suppressHydrationWarning className="text-xs text-muted-foreground">
              {formattedTime}
            </span>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: copy.jobs.columns.actions,
      cell: ({ row }) => {
        const job = row.original;
        const isDone = job.status === 'done';
        const isReport = REPORT_JOB_KINDS.includes(job.kind ?? '');
        // The detail view is the analysis pipeline (converting → analyzing →
        // synthesizing). Showing it for a CSV export claimed the export had gone
        // through DICOM conversion, which it never does.
        const canDownloadInline = isDone && isReport && Boolean(job.result?.csvBase64);
        const canDownloadFromBlob = isDone && isReport && Boolean(job.result?.blobPath);
        const isDownloading = downloadingId === job._id;

        async function downloadInline() {
          if (!job.result?.csvBase64) return;
          setDownloadingId(job._id);
          try {
            const binary = atob(job.result.csvBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: job.result.mimeType || 'text/csv' });
            downloadBlob(blob, job.result.fileName || `${job.examId}.csv`);
          } catch {
            showErrorToast();
          } finally {
            setDownloadingId(null);
          }
        }

        async function downloadFromBlob() {
          setDownloadingId(job._id);
          try {
            // Server proxies (and gunzips) the Azure blob. We buffer the
            // response into a Blob so we can keep the spinner up until the
            // download is fully fetched — acceptable trade-off for CSV-sized
            // payloads. Revisit if exports start hitting hundreds of MB.
            const blob = await apiFetch<Blob>(endpointForJobDownload(job._id), {
              method: 'GET',
              responseType: 'blob',
            });
            downloadBlob(blob, job.result?.fileName?.replace(/\.gz$/i, '') || `${job.examId}.csv`);
          } catch {
            showErrorToast();
          } finally {
            setDownloadingId(null);
          }
        }

        const showDownload = canManageSystemJobs && (canDownloadInline || canDownloadFromBlob);
        const onClick = canDownloadInline ? downloadInline : downloadFromBlob;
        return (
          <div className="flex items-center justify-center gap-2">
            <JobDetailModal jobId={job._id} examId={job.examId} />
            {showDownload && (
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-full md:size-8"
                title={copy.jobs.downloadCsv}
                onClick={onClick}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: jobs,
    columns,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: () => {},
    state: {
      columnFilters,
      columnVisibility,
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });

  // Values must match JOB_SEARCH_FIELDS in the jobs service.
  const searchTypeOptions = [
    { value: 'examId', label: copy.jobs.columns.examId },
    { value: 'kind', label: copy.jobs.columns.kind },
    { value: 'status', label: copy.jobs.columns.status },
    { value: 'type', label: copy.jobs.filters.type },
  ];

  const visiblePages = visiblePageWindow(currentPage, totalPages);

  function navigate(params: URLSearchParams) {
    router.push(`${pathname}?${params.toString()}`);
  }

  // `organizationId` is deliberately untouched here — it belongs to the header's
  // organization scope, and preserving it keeps the scope alive across filtering.
  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());
    const entries: Record<string, string> = {
      q: textSearch,
      searchType: textSearch ? selectedSearchType : '',
      kind: selectedKind === 'all' ? '' : selectedKind,
      dateFrom,
      dateTo,
    };
    Object.entries(entries).forEach(([key, value]) => {
      const normalized = value.trim();
      if (normalized) params.set(key, normalized);
      else params.delete(key);
    });
    params.set('page', '1');
    navigate(params);
  }

  function clearFilters() {
    // No local reset: dropping the params makes the server send the defaults
    // back, and the draft resyncs to whatever is actually applied.
    const params = new URLSearchParams(searchParams.toString());
    ['q', 'searchType', 'kind', 'dateFrom', 'dateTo'].forEach((key) => params.delete(key));
    params.set('page', '1');
    navigate(params);
  }

  function pageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    return `?${params.toString()}`;
  }

  return (
    <div className="w-full">
      <FilterShell>
        <FilterRow>
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {copy.jobs.filters.searchLabel}
              </Label>
              {/* Field picker glued to the input, like the worklist: searching
                  "done" across every field matches a status AND any exam id that
                  happens to contain it. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-0">
                <Select
                  value={selectedSearchType}
                  onValueChange={(value) => setField('selectedSearchType', value)}
                >
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder={copy.jobs.filters.searchField} />
                  </SelectTrigger>
                  <SelectContent>
                    {searchTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={textSearch}
                  onChange={(event) => setField('textSearch', event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyFilters();
                  }}
                  placeholder={formatCopy(copy.jobs.filters.searchBy, {
                    field:
                      searchTypeOptions.find((option) => option.value === selectedSearchType)
                        ?.label ?? copy.jobs.columns.examId,
                  })}
                  className="w-full min-w-0 sm:flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {copy.jobs.filters.jobType}
              </Label>
              <Select
                value={selectedKind}
                onValueChange={(value) => setField('selectedKind', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={copy.jobs.filters.kindPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{copy.jobs.filters.allKinds}</SelectItem>
                  {/* Filtering by a report kind returns nothing for a tenant,
                      so offering it would read as "the table is broken". */}
                  {visibleJobKinds.map((jobKind) => (
                    <SelectItem key={jobKind} value={jobKind}>
                      {copy.jobs.filters.kindLabels[jobKind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {copy.jobs.filters.from}
              </Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => setField('fromDate', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {copy.jobs.filters.to}
              </Label>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => setField('toDate', event.target.value)}
              />
            </div>
          </div>
          <FilterActions onApply={applyFilters} onClear={clearFilters} />
        </FilterRow>
      </FilterShell>
      <DataTableCard>
        <DataTableToolbar className="justify-between">
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
          {canManageSystemJobs && <JobCreateModal />}
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
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <BriefcaseBusiness className="size-8 text-muted-foreground/50" />
                    {copy.jobs.empty}
                  </div>
                </TableCell>
              </TableRow>
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
                    <PaginationLink href={pageHref(page as number)} isActive={currentPage === page}>
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
