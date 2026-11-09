import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import { type AppPageProps, getSearchParamString } from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { monthLabel, shiftMonth } from '@/app/lib/outflow-format';
import {
  getInternalUseSummary,
  getWasteSummary,
  type InternalUseSummary,
  listInternalUsePeople,
  type WasteSummary,
} from '@/app/lib/services/internal-use';
import { getRecipeIngredientOptions } from '@/app/lib/services/products';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { InternalUseActions } from '@/components/internal-use-actions';
import { InternalUseView } from '@/components/internal-use-view';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { Button } from '@/components/ui/button';
import { WasteView } from '@/components/waste-view';

type View = 'use' | 'waste';

function ViewTabs(props: {
  active: View;
  hrefFor: (view: View) => string;
  labels: { use: string; waste: string };
}) {
  const tab = (view: View) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      props.active === view
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`;
  return (
    <nav className="flex gap-1" aria-label="views">
      {(['use', 'waste'] as const).map((view) => (
        <Link
          key={view}
          href={props.hrefFor(view)}
          className={tab(view)}
          aria-current={props.active === view ? 'page' : undefined}
        >
          {props.labels[view]}
        </Link>
      ))}
    </nav>
  );
}

export default async function InternalUse(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.internalUse;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const requestedMonth = getSearchParamString(searchParams, 'month', '');
  const view: View =
    getSearchParamString(searchParams, 'view', 'use') === 'waste' ? 'waste' : 'use';

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('internal-use', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.internalUse.title}
        description={copy.pages.internalUse.description}
        icon={UserRound}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque and Notas: no "all", a use always belongs to one store. A missing or unauthorized
  // id falls back to the first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  const href = (target: { view?: View; month?: string }) => {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    const month = target.month ?? requestedMonth;
    if (month) params.set('month', month);
    if ((target.view ?? view) === 'waste') params.set('view', 'waste');
    return `/organization/internal-use?${params.toString()}`;
  };
  if (selectedStore._id !== requestedStoreId) redirect(href({}));

  let useSummary: InternalUseSummary | undefined;
  let wasteSummary: WasteSummary | undefined;
  let options;
  let people: string[] = [];
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    options = await getRecipeIngredientOptions(selectedStore._id);
    const month = requestedMonth || undefined;
    if (view === 'waste') {
      wasteSummary = await getWasteSummary(selectedStore._id, { month });
    } else {
      [useSummary, people] = await Promise.all([
        getInternalUseSummary(selectedStore._id, { month }),
        listInternalUsePeople(selectedStore._id),
      ]);
    }
  } catch (err) {
    logPageLoadError('internal-use', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }
  const month = (wasteSummary ?? useSummary)?.month ?? requestedMonth;

  return (
    <PageShell
      title={copy.pages.internalUse.title}
      description={copy.pages.internalUse.description}
      icon={UserRound}
    >
      <div className="flex flex-col gap-6">
        <ViewTabs active={view} hrefFor={(target) => href({ view: target })} labels={text.views} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon" title={text.previousMonth}>
              <Link href={href({ month: shiftMonth(month, -1) })} aria-label={text.previousMonth}>
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <span className="min-w-32 text-center text-sm font-medium capitalize">
              {monthLabel(month)}
            </span>
            <Button asChild variant="outline" size="icon" title={text.nextMonth}>
              <Link href={href({ month: shiftMonth(month, 1) })} aria-label={text.nextMonth}>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
            <InternalUseActions
              key={view}
              mode={view}
              storeId={selectedStore._id}
              options={options}
              people={people}
            />
          </div>
        </div>
        {wasteSummary ? <WasteView summary={wasteSummary} text={text} /> : null}
        {useSummary ? <InternalUseView summary={useSummary} text={text} /> : null}
      </div>
    </PageShell>
  );
}
