import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReceiptText } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { formatCopy } from '@/app/lib/i18n/format';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import {
  getMissingRecipesForStore,
  getOrdersPageForStore,
  getOrdersSummaryForStore,
  type MissingRecipeRow,
  type OrderStockFilter,
  type OrdersPage,
  type OrdersSummary,
} from '@/app/lib/services/orders';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { DataTableOrders } from '@/components/data-table-orders';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FILTERS: readonly OrderStockFilter[] = [
  'all',
  'incomplete',
  'debited',
  'pending',
  'reversed',
];
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

export default async function Orders(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.orders;
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
    logPageLoadError('orders', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.orders.title}
        description={copy.pages.orders.description}
        icon={ReceiptText}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Produtos: no "all", an order always belongs to one store. A missing or
  // unauthorized id falls back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/orders?${params.toString()}`);
  }

  let orders: OrdersPage;
  let summary: OrdersSummary;
  let missing: MissingRecipeRow[];
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    [orders, summary, missing] = await Promise.all([
      getOrdersPageForStore(selectedStore._id, { page, limit: 20, q: searchTerm, filter }),
      getOrdersSummaryForStore(selectedStore._id),
      getMissingRecipesForStore(selectedStore._id),
    ]);
  } catch (err) {
    logPageLoadError('orders', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a filter narrowed the list). Every applied param rides along.
  if (orders.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, orders.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (filter !== 'all') params.set('filter', filter);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/orders?${params.toString()}`);
  }

  const cards = [
    { ...text.summary.orders, value: String(summary.orders) },
    {
      ...text.summary.coverage,
      value: summary.coverage === undefined ? '—' : percent.format(summary.coverage),
    },
    { ...text.summary.incomplete, value: String(summary.incomplete) },
    { ...text.summary.revenue, value: money.format(summary.incompleteRevenue) },
  ];
  const withParams = (path: string, name: string) => {
    const params = new URLSearchParams({ storeId: selectedStore._id, q: name });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    return `${path}?${params.toString()}`;
  };

  return (
    <PageShell
      title={copy.pages.orders.title}
      description={copy.pages.orders.description}
      icon={ReceiptText}
    >
      <div className="flex flex-col gap-4">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label} title={card.hint}>
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {missing.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{text.missing.title}</CardTitle>
              <CardDescription>{text.missing.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {missing.map((row) => (
                  <li
                    key={`${row.kind}-${row.codPdv}-${row.name}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <Badge variant="outline">
                      {row.kind === 'product' ? text.missing.product : text.missing.modifier}
                    </Badge>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground">
                      {formatCopy(text.missing.orders, { count: row.orders })} ·{' '}
                      {money.format(row.revenue)}
                    </span>
                    <Link
                      className="ml-auto text-primary underline-offset-4 hover:underline"
                      href={withParams(
                        row.kind === 'product'
                          ? '/organization/products'
                          : '/organization/modifiers',
                        row.name,
                      )}
                    >
                      {row.kind === 'product'
                        ? text.missing.registerProduct
                        : text.missing.registerModifier}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <DataTableOrders
          storeId={selectedStore._id}
          orders={orders.data}
          total={orders.total}
          totalPages={orders.totalPages}
          currentPage={page}
          searchTerm={searchTerm}
          filter={filter}
          incompleteCount={summary.incomplete}
        />
      </div>
    </PageShell>
  );
}
