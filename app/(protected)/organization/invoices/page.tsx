import { redirect } from 'next/navigation';
import { FileText } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import {
  getNfeNotesPageForStore,
  getNfeNotesSummaryForStore,
  type NfeNoteFilter,
  type NfeNotesPage,
  type NfeNotesSummary,
} from '@/app/lib/services/nfe-documents';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { DataTableInvoices } from '@/components/data-table-invoices';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FILTERS: readonly NfeNoteFilter[] = ['all', 'preview', 'full', 'cancelled'];

export default async function Invoices(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.invoices;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const filter =
    FILTERS.find((v) => v === getSearchParamString(searchParams, 'filter', 'all')) ?? 'all';

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('invoices', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.invoices.title}
        description={copy.pages.invoices.description}
        icon={FileText}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Pedidos: no "all", a note always belongs to one store. A missing or
  // unauthorized id falls back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/invoices?${params.toString()}`);
  }

  let notes: NfeNotesPage;
  let summary: NfeNotesSummary;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    [notes, summary] = await Promise.all([
      getNfeNotesPageForStore(selectedStore._id, { page, limit: 20, q: searchTerm, filter }),
      getNfeNotesSummaryForStore(selectedStore._id),
    ]);
  } catch (err) {
    logPageLoadError('invoices', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a filter narrowed the list). Every applied param rides along.
  if (notes.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, notes.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (filter !== 'all') params.set('filter', filter);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/invoices?${params.toString()}`);
  }

  const cards = [
    { ...text.summary.total, value: String(summary.total) },
    { ...text.summary.captured, value: String(summary.captured) },
    { ...text.summary.previews, value: String(summary.previews) },
  ];

  return (
    <PageShell
      title={copy.pages.invoices.title}
      description={copy.pages.invoices.description}
      icon={FileText}
    >
      <div className="flex flex-col gap-4">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />

        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map((card) => (
            <Card key={card.label} title={card.hint}>
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <DataTableInvoices
          storeId={selectedStore._id}
          notes={notes.data}
          total={notes.total}
          totalPages={notes.totalPages}
          currentPage={page}
          searchTerm={searchTerm}
          filter={filter}
        />
      </div>
    </PageShell>
  );
}
