'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { formatDateShortUtc, formatTimeShortUtc } from '@/app/lib/date-format';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { visiblePageWindow } from '@/app/lib/pagination';
import type { AuditEventListItem } from '@/app/lib/services/audit-events';
import { showSuccessToast } from '@/app/lib/toast';
import { FilterActions, FilterRow, FilterShell } from '@/components/filter-shell';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { ActionButton } from '@/components/ui/action-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useFilterDraft } from '@/hooks/use-filter-draft';

const AUDIT_EVENTS_PATH = '/system/audit-events';

export function DataTableAuditEvents({
  events,
  actions,
  totalPages,
  total,
  currentPage,
  filters,
}: {
  events: AuditEventListItem[];
  actions: string[];
  totalPages: number;
  total: number;
  currentPage: number;
  filters: { dateFrom: string; dateTo: string; action: string; actor: string };
}) {
  const copy = useCopy();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL owns the applied filters; this is the copy the user is editing.
  const { draft, setField } = useFilterDraft({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    action: filters.action || 'all',
    actor: filters.actor,
  });
  const { dateFrom, dateTo, action, actor } = draft;

  function buildParams(next: Partial<typeof draft>, page = 1) {
    const params = new URLSearchParams(searchParams.toString());
    const entries = {
      dateFrom: next.dateFrom ?? dateFrom,
      dateTo: next.dateTo ?? dateTo,
      action: next.action ?? action,
      actor: next.actor ?? actor,
    };
    Object.entries(entries).forEach(([key, value]) => {
      const normalized = key === 'action' && value === 'all' ? '' : value.trim();
      if (normalized) params.set(key, normalized);
      else params.delete(key);
    });
    params.set('page', String(page));
    return params;
  }

  function applyFilters() {
    router.push(`${AUDIT_EVENTS_PATH}?${buildParams({}).toString()}`);
  }

  function clearFilters() {
    // No local reset: dropping the params makes the server send the default
    // range back, and the draft resyncs to whatever is actually applied.
    router.push(
      `${AUDIT_EVENTS_PATH}?${buildParams({ dateFrom: '', dateTo: '', action: 'all', actor: '' }).toString()}`,
    );
  }

  function pageHref(page: number) {
    return `${AUDIT_EVENTS_PATH}?${buildParams(filters, page).toString()}`;
  }

  const visiblePages = visiblePageWindow(currentPage, totalPages);

  // Keep the applied action selectable even if it produced no rows in this
  // window — otherwise the Select would show an empty trigger.
  const actionOptions = Array.from(
    new Set([...(filters.action ? [filters.action] : []), ...actions]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <FilterShell>
        <FilterRow>
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[160px_160px_220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="audit-date-from">{copy.auditEvents.dateFrom}</Label>
              <Input
                id="audit-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setField('dateFrom', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-date-to">{copy.auditEvents.dateTo}</Label>
              <Input
                id="audit-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setField('dateTo', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-action">{copy.auditEvents.action}</Label>
              <Select value={action} onValueChange={(value) => setField('action', value)}>
                <SelectTrigger id="audit-action">
                  <SelectValue placeholder={copy.auditEvents.allActions} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{copy.auditEvents.allActions}</SelectItem>
                  {/* Action names are dotted verbs recorded by the routes, not
                      copy — translating them would break the filter round-trip. */}
                  {actionOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-actor">{copy.auditEvents.actor}</Label>
              <Input
                id="audit-actor"
                value={actor}
                onChange={(event) => setField('actor', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyFilters();
                }}
                placeholder={copy.auditEvents.actorPlaceholder}
              />
            </div>
          </div>
          <FilterActions onApply={applyFilters} onClear={clearFilters} />
        </FilterRow>
      </FilterShell>

      <DataTableCard>
        {/* Same toolbar strip the other listings carry. No create action: audit
            events are written by the routes, never by hand. */}
        <DataTableToolbar className="justify-start">
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
        </DataTableToolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.auditEvents.time}</TableHead>
              <TableHead>{copy.auditEvents.organization}</TableHead>
              <TableHead>{copy.auditEvents.actor}</TableHead>
              <TableHead>{copy.auditEvents.action}</TableHead>
              <TableHead>{copy.auditEvents.resource}</TableHead>
              <TableHead>{copy.auditEvents.source}</TableHead>
              <TableHead>{copy.auditEvents.outcome}</TableHead>
              <TableHead>{copy.auditEvents.message}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length ? (
              events.map((event) => (
                <TableRow key={event._id}>
                  <TableCell>
                    {`${formatDateShortUtc(event.createdAt)} ${formatTimeShortUtc(event.createdAt)}`}
                  </TableCell>
                  <TableCell>{event.organizationName || '-'}</TableCell>
                  <TableCell>
                    {event.actorName || event.actorEmail || copy.auditEvents.unknownActor}
                  </TableCell>
                  <TableCell>{event.action}</TableCell>
                  <TableCell>
                    {event.resourceType}
                    {event.resourceId ? `:${event.resourceId}` : ''}
                  </TableCell>
                  <TableCell>{event.source}</TableCell>
                  <TableCell>{event.outcome}</TableCell>
                  <TableCell>{event.message}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  {copy.auditEvents.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {/* Always rendered, like the jobs and users tables: a footer that
            appears only past page 1 makes the list look unpaginated on a
            first read. */}
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

      <p className="sr-only">
        {copy.auditEvents.apiMarker}: {endpointFor(AppFeature.AUDIT_EVENTS_GET)}
      </p>
    </div>
  );
}
