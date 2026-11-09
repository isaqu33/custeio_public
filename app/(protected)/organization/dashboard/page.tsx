import { redirect } from 'next/navigation';
import { AlertTriangle, LayoutDashboard, PackageSearch, Receipt, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import { type AppPageProps, getSearchParamString } from '@/app/lib/page-props';
import { formatCopy } from '@/app/lib/i18n/format';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { formatMoney } from '@/app/lib/quantity-format';
import { type DashboardData, getDashboardForStore } from '@/app/lib/services/dashboard';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { cn } from '@/app/lib/utils';
import { AttentionList } from '@/components/attention-list';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

// The tenant's landing page: the four numbers the product leads with, then what needs a decision.
// Open to any authenticated, organization-scoped session (no feature gates it); every query is
// scoped to a store the session may see.
const TILES: Array<{
  key: 'stockValue' | 'cmv' | 'margin' | 'lowStock';
  icon: LucideIcon;
  tone: string;
}> = [
  { key: 'stockValue', icon: PackageSearch, tone: 'text-chart-1' },
  { key: 'cmv', icon: Receipt, tone: 'text-chart-4' },
  { key: 'margin', icon: TrendingUp, tone: 'text-chart-2' },
  { key: 'lowStock', icon: AlertTriangle, tone: 'text-chart-5' },
];

const percent = (fraction: number | null) =>
  fraction === null ? '—' : `${(fraction * 100).toFixed(1)}%`;

export default async function DashboardPage(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const tileCopy = copy.dashboard.tiles;
  const live = copy.dashboard.live;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('dashboard', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.dashboard.title}
        description={copy.pages.dashboard.description}
        icon={LayoutDashboard}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{live.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{live.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Notas: no "all", the numbers belong to one store. A missing or unauthorized id
  // falls back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  const query = new URLSearchParams({ storeId: selectedStore._id });
  if (organizationId !== 'all') query.set('organizationId', organizationId);
  if (selectedStore._id !== requestedStoreId)
    redirect(`/organization/dashboard?${query.toString()}`);

  let data: DashboardData;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    data = await getDashboardForStore(selectedStore._id);
  } catch (err) {
    logPageLoadError('dashboard', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const { tiles } = data;
  const values = {
    stockValue: formatMoney(tiles.stockValue),
    cmv: percent(tiles.cmv),
    margin: percent(tiles.margin),
    lowStock: String(tiles.lowStock),
  };
  const notes: Partial<Record<(typeof TILES)[number]['key'], string>> = {
    stockValue: live.stockValueNote,
    cmv:
      tiles.margin === null
        ? live.noMargin
        : formatCopy(live.marginNote, { complete: tiles.completeOrders, orders: tiles.orders }),
    margin:
      tiles.margin === null
        ? live.noMargin
        : formatCopy(live.marginNote, { complete: tiles.completeOrders, orders: tiles.orders }),
  };

  return (
    <PageShell
      title={copy.pages.dashboard.title}
      description={copy.pages.dashboard.description}
      icon={LayoutDashboard}
    >
      <div className="flex flex-col gap-6">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TILES.map(({ key, icon: Icon, tone }) => (
            <Card key={key} className="relative overflow-hidden">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <div
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg bg-muted',
                    tone,
                  )}
                >
                  <Icon className="size-4.5" />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {values[key]}
                </span>
                <span className="text-sm font-medium">{tileCopy[key].label}</span>
                <p className="text-xs leading-snug text-muted-foreground">{tileCopy[key].hint}</p>
                {notes[key] ? (
                  <p className="text-xs leading-snug text-amber-700 dark:text-amber-500">
                    {notes[key]}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <AttentionList items={data.attention} text={live} storeQuery={query.toString()} />
      </div>
    </PageShell>
  );
}
