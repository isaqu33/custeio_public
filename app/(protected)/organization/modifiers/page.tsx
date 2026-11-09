import { redirect } from 'next/navigation';
import { ListPlus } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { getModifiersPageForStore, type ModifiersPage } from '@/app/lib/services/modifiers';
import {
  getRecipeIngredientOptions,
  type RecipeIngredientOption,
} from '@/app/lib/services/products';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { ModifiersTable } from '@/components/modifiers-table';
import { PageShell } from '@/components/page-shell';
import { StoreScopeSelector } from '@/components/store-scope-selector';

function hrefFor(storeId: string, organizationId: string) {
  const params = new URLSearchParams({ storeId });
  if (organizationId !== 'all') params.set('organizationId', organizationId);
  return `/organization/modifiers?${params.toString()}`;
}

export default async function Modifiers(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const text = copy.modifiers;
  const searchParams = await props.searchParams;
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('modifiers', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.modifiers.title}
        description={copy.pages.modifiers.description}
        icon={ListPlus}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{text.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{text.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // A missing or unauthorized store id falls back to the first one the session may see.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;
  if (selectedStore._id !== requestedStoreId) {
    redirect(hrefFor(selectedStore._id, organizationId));
  }

  let modifiers: ModifiersPage;
  let ingredients: RecipeIngredientOption[];
  try {
    // `selectedStore` only comes from `storeOptions`, already scoped to this session.
    [modifiers, ingredients] = await Promise.all([
      getModifiersPageForStore(selectedStore._id, { page, limit: 20, q: searchTerm }),
      getRecipeIngredientOptions(selectedStore._id),
    ]);
  } catch (err) {
    logPageLoadError('modifiers', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a search narrowed the list). Every applied param rides along.
  if (modifiers.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, modifiers.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/modifiers?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.modifiers.title}
      description={copy.pages.modifiers.description}
      icon={ListPlus}
    >
      <div className="flex flex-col gap-4">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <p className="text-sm text-muted-foreground">{text.hint}</p>

        <ModifiersTable
          storeId={selectedStore._id}
          modifiers={modifiers.data}
          ingredients={ingredients}
          total={modifiers.total}
          totalPages={modifiers.totalPages}
          currentPage={page}
          searchTerm={searchTerm}
        />
      </div>
    </PageShell>
  );
}
