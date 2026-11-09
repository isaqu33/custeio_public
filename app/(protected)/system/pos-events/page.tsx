import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Webhook } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import {
  getPosEventsPageForStore,
  type PosEventKindFilter,
  type PosEventsPage,
} from '@/app/lib/services/pos-events';
import { getBridgeErrors } from '@/app/lib/services/bridge-errors';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { BridgeErrorsPanel } from '@/components/bridge-errors-panel';
import { DataTablePosEvents } from '@/components/data-table-pos-events';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';

const KINDS: readonly PosEventKindFilter[] = [
  'all',
  'new_order',
  'status_change',
  'cancellation',
  'unknown',
];

function ViewTabs(props: {
  storeId: string;
  organizationId: string;
  active: 'events' | 'errors';
  labels: { events: string; errors: string };
}) {
  const href = (view: 'events' | 'errors') => {
    const params = new URLSearchParams({ storeId: props.storeId });
    if (props.organizationId !== 'all') params.set('organizationId', props.organizationId);
    if (view === 'errors') params.set('view', 'errors');
    return `/system/pos-events?${params.toString()}`;
  };
  const tab = (view: 'events' | 'errors') =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      props.active === view
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`;
  return (
    <nav className="flex gap-1" aria-label="views">
      <Link
        href={href('events')}
        className={tab('events')}
        aria-current={props.active === 'events' ? 'page' : undefined}
      >
        {props.labels.events}
      </Link>
      <Link
        href={href('errors')}
        className={tab('errors')}
        aria-current={props.active === 'errors' ? 'page' : undefined}
      >
        {props.labels.errors}
      </Link>
    </nav>
  );
}

export default async function PosEvents(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  // Access is already enforced by app/(protected)/system/layout.tsx (requireSystemAccess).
  const copy = await getServerCopyForSession(session);
  const text = copy.posEvents;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const requestedKind = getSearchParamString(searchParams, 'kind', 'all');
  const kind = KINDS.find((value) => value === requestedKind) ?? 'all';
  const view =
    getSearchParamString(searchParams, 'view', 'events') === 'errors' ? 'errors' : 'events';

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('pos-events', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.posEvents.title}
        description={copy.pages.posEvents.description}
        icon={Webhook}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Produtos: no "all", an event always belongs to one store. A missing or
  // unauthorized id falls back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/system/pos-events?${params.toString()}`);
  }

  if (view === 'errors') {
    const bridgeErrors = await getBridgeErrors();
    return (
      <PageShell
        title={copy.pages.posEvents.title}
        description={copy.pages.posEvents.description}
        icon={Webhook}
      >
        <div className="flex flex-col gap-4">
          <ViewTabs
            storeId={selectedStore._id}
            organizationId={organizationId}
            active="errors"
            labels={text.views}
          />
          <BridgeErrorsPanel view={bridgeErrors} copy={text.errors} locale="pt-BR" />
        </div>
      </PageShell>
    );
  }

  let events: PosEventsPage;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    events = await getPosEventsPageForStore(selectedStore._id, {
      page,
      limit: 20,
      kind,
      q: searchTerm,
    });
  } catch (err) {
    logPageLoadError('pos-events', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a filter narrowed the list). Every applied param rides along.
  if (events.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, events.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (kind !== 'all') params.set('kind', kind);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/system/pos-events?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.posEvents.title}
      description={copy.pages.posEvents.description}
      icon={Webhook}
    >
      <div className="flex flex-col gap-4">
        <ViewTabs
          storeId={selectedStore._id}
          organizationId={organizationId}
          active="events"
          labels={text.views}
        />
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <DataTablePosEvents
          events={events.data}
          total={events.total}
          totalPages={events.totalPages}
          currentPage={page}
          searchTerm={searchTerm}
          kind={kind}
        />
      </div>
    </PageShell>
  );
}
