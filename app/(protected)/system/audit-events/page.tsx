import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError, logPageLoadRejected } from '@/app/lib/page-logging';
import {
  listAuditEventsForSession,
  type AuditEventsListResult,
} from '@/app/lib/services/audit-events';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { PageShell } from '@/components/page-shell';
import { ClipboardList } from 'lucide-react';
import { DataTableAuditEvents } from '@/components/table-audit-events';
import { redirect } from 'next/navigation';

// Same default window as the sibling worklist: an audit log grows without bound,
// so an unfiltered first load would scan everything the tenant ever did.
const AUDIT_EVENTS_DEFAULT_DAYS = 15;

function formatDateInputUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultAuditEventDateFilters(now = new Date()) {
  const dateTo = new Date(now);
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - (AUDIT_EVENTS_DEFAULT_DAYS - 1));
  return { dateFrom: formatDateInputUtc(dateFrom), dateTo: formatDateInputUtc(dateTo) };
}

export default async function AuditEventsPage(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  // Access is already enforced by app/(protected)/system/layout.tsx
  // (requireSystemAccess) — this page needs no guard of its own.
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const defaults = getDefaultAuditEventDateFilters();
  const filters = {
    dateFrom: getSearchParamString(searchParams, 'dateFrom', defaults.dateFrom),
    dateTo: getSearchParamString(searchParams, 'dateTo', defaults.dateTo),
    action: getSearchParamString(searchParams, 'action', ''),
    actor: getSearchParamString(searchParams, 'actor', ''),
  };

  // Organization is NOT one of this page's filters — it comes from the
  // organization scope bar in the page header (OrganizationWorkspaceFrame),
  // the same way the worklist does it. Absent means every organization the
  // session may see.
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');

  let eventsData: AuditEventsListResult;
  try {
    eventsData = await listAuditEventsForSession(session, {
      page,
      limit: 20,
      organizationId,
      ...filters,
    });
  } catch (err) {
    logPageLoadError('audit-events', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  if (!eventsData.done) {
    logPageLoadRejected('audit-events');
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  return (
    <PageShell
      title={copy.pages.auditEvents.title}
      description={copy.pages.auditEvents.description}
      icon={ClipboardList}
    >
      <DataTableAuditEvents
        events={eventsData.data}
        actions={eventsData.actions}
        totalPages={eventsData.totalPages}
        total={eventsData.total}
        currentPage={page}
        filters={filters}
      />
    </PageShell>
  );
}
