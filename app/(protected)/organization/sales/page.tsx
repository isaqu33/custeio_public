import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChartColumn } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { formatCopy } from '@/app/lib/i18n/format';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { formatMoney } from '@/app/lib/quantity-format';
import type { SalesHistory } from '@/app/lib/sales-history';
import { getSalesHistoryForStore } from '@/app/lib/services/sales-history';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { PageShell } from '@/components/page-shell';
import { SalesHistoryTables } from '@/components/sales-history-tables';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const PERIODS = [7, 14, 30] as const;

export default async function Sales(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.sales;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const requestedDays = getSearchParamNumber(searchParams, 'days', 14);
  const days = PERIODS.find((value) => value === requestedDays) ?? 14;

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('sales', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.sales.title}
        description={copy.pages.sales.description}
        icon={ChartColumn}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Notas: no "all", sales belong to one store. A missing or unauthorized id falls
  // back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  const href = (period: number) => {
    const params = new URLSearchParams({ storeId: selectedStore._id, days: String(period) });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    return `/organization/sales?${params.toString()}`;
  };
  if (selectedStore._id !== requestedStoreId) redirect(href(days));

  let history: SalesHistory;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    history = await getSalesHistoryForStore(selectedStore._id, { days });
  } catch (err) {
    logPageLoadError('sales', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const { totals } = history;
  const cards = [
    { ...text.summary.orders, value: String(totals.orders), sub: undefined },
    { ...text.summary.revenue, value: formatMoney(totals.revenue), sub: undefined },
    { ...text.summary.ticket, value: formatMoney(totals.avgTicket), sub: undefined },
    {
      ...text.summary.margin,
      value: totals.margin === null ? '—' : `${(totals.margin * 100).toFixed(1)}%`,
      sub: formatCopy(text.marginOf, { complete: totals.completeOrders, total: totals.orders }),
    },
  ];

  return (
    <PageShell
      title={copy.pages.sales.title}
      description={copy.pages.sales.description}
      icon={ChartColumn}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
          <nav className="flex gap-1" aria-label="period">
            {PERIODS.map((period) => (
              <Link
                key={period}
                href={href(period)}
                aria-current={period === days ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  period === days
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {text.periods[period]}
              </Link>
            ))}
          </nav>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label} title={card.hint}>
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
                {card.sub ? <p className="text-xs text-muted-foreground">{card.sub}</p> : null}
              </CardHeader>
            </Card>
          ))}
        </div>

        <SalesHistoryTables history={history} text={text} channels={copy.posEvents.channels} />
      </div>
    </PageShell>
  );
}
