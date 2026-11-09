import { redirect } from 'next/navigation';
import { ChefHat } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import { type AppPageProps, getSearchParamString } from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { getRawIngredientsPageForStore } from '@/app/lib/services/raw-ingredients';
import { getRecipeIngredientOptions } from '@/app/lib/services/products';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { PageShell } from '@/components/page-shell';
import { PreparationsView } from '@/components/preparations-view';
import { StoreScopeSelector } from '@/components/store-scope-selector';

// A store makes a handful of preparations: one page, no pagination.
const LIMIT = 200;

export default async function Preparations(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('preparations', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const shell = (children: React.ReactNode) => (
    <PageShell
      title={copy.pages.preparations.title}
      description={copy.pages.preparations.description}
      icon={ChefHat}
    >
      {children}
    </PageShell>
  );

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return shell(
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
        <p className="text-sm font-medium">{copy.rawIngredients.noStoresTitle}</p>
        <p className="text-sm text-muted-foreground">{copy.rawIngredients.noStoresDescription}</p>
      </div>,
    );
  }

  // Like Estoque: preparations belong to one store; a missing or unauthorized id falls back to the
  // first store and the URL is canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams({ storeId: selectedStore._id });
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/preparations?${params.toString()}`);
  }

  let preparations;
  let candidates;
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    [preparations, candidates] = await Promise.all([
      getRawIngredientsPageForStore(selectedStore._id, { limit: LIMIT, preparations: 'only' }),
      getRecipeIngredientOptions(selectedStore._id),
    ]);
  } catch (err) {
    logPageLoadError('preparations', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  return shell(
    <div className="flex flex-col gap-4">
      <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
      <PreparationsView
        storeId={selectedStore._id}
        preparations={preparations.data}
        candidates={candidates}
      />
    </div>,
  );
}
