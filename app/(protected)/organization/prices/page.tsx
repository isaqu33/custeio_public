import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import { type AppPageProps, getSearchParamString } from '@/app/lib/page-props';
import { formatCopy } from '@/app/lib/i18n/format';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { formatMoney, formatUnitCost } from '@/app/lib/quantity-format';
import { getPriceReportForStore, type PriceReportView } from '@/app/lib/services/price-report';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { PageShell } from '@/components/page-shell';
import { PriceReportTables } from '@/components/price-report-tables';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const MIN_PERCENT = 5;

export default async function Prices(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.prices;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('prices', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.prices.title}
        description={copy.pages.prices.description}
        icon={TrendingUp}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Notas: no "all", prices belong to one store. A missing or unauthorized id falls
  // back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/prices?${params.toString()}`);
  }

  let report: PriceReportView;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    report = await getPriceReportForStore(selectedStore._id, { minPercent: MIN_PERCENT });
  } catch (err) {
    logPageLoadError('prices', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const cards = [
    { ...text.summary.changes, value: String(report.changes.length) },
    { ...text.summary.impact, value: formatMoney(report.totalExtraPaid) },
  ];

  return (
    <PageShell
      title={copy.pages.prices.title}
      description={copy.pages.prices.description}
      icon={TrendingUp}
    >
      <div className="flex flex-col gap-6">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <Card key={card.label} title={card.hint}>
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
        <PriceReportTables
          report={report}
          text={text}
          hint={formatCopy(text.changesHint, { days: report.windowDays, min: MIN_PERCENT })}
          formatCost={formatUnitCost}
        />
      </div>
    </PageShell>
  );
}
