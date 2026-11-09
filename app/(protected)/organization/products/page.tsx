import { redirect } from 'next/navigation';
import { UtensilsCrossed } from 'lucide-react';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import {
  getProductsPageForStore,
  getProductsSummaryForStore,
  getRecipeCopySourcesForStore,
  getRecipeIngredientOptions,
  type ProductStatusFilter,
  type ProductsPage,
  type ProductsSummary,
  type RecipeCopySource,
  type RecipeIngredientOption,
} from '@/app/lib/services/products';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { DataTableProducts } from '@/components/data-table-products';
import { PageShell } from '@/components/page-shell';
import { ProductsSummaryCards } from '@/components/products-summary-cards';
import { StoreScopeSelector } from '@/components/store-scope-selector';

const STATUSES: readonly ProductStatusFilter[] = ['active', 'inactive', 'all'];

export default async function Products(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  // The organization comes from the scope bar in the page header
  // (OrganizationWorkspaceFrame), the same way Estoque does it.
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const requestedStatus = getSearchParamString(searchParams, 'status', 'active');
  // Active by default: the hidden iFood copies would otherwise outnumber the real menu.
  const status = STATUSES.find((value) => value === requestedStatus) ?? 'active';

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('products', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.products.title}
        description={copy.pages.products.description}
        icon={UtensilsCrossed}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{copy.products.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{copy.products.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // Like Estoque: no "all" here, a product always belongs to one store. A
  // missing or unauthorized id falls back to the first store and the URL is
  // canonicalized to match.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;

  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams();
    params.set('storeId', selectedStore._id);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/products?${params.toString()}`);
  }

  let productsPage: ProductsPage;
  let summary: ProductsSummary;
  let ingredients: RecipeIngredientOption[];
  let copySources: RecipeCopySource[];
  try {
    // No extra access check: `selectedStore` only ever comes from `storeOptions`,
    // which `getStoreOptionsForSession` already scoped to this session.
    [productsPage, summary, ingredients, copySources] = await Promise.all([
      getProductsPageForStore(selectedStore._id, { page, limit: 20, q: searchTerm, status }),
      getProductsSummaryForStore(selectedStore._id),
      getRecipeIngredientOptions(selectedStore._id),
      getRecipeCopySourcesForStore(selectedStore._id),
    ]);
  } catch (err) {
    logPageLoadError('products', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a search narrowed the list). Every applied param rides along.
  if (productsPage.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, productsPage.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (status !== 'active') params.set('status', status);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/products?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.products.title}
      description={copy.pages.products.description}
      icon={UtensilsCrossed}
    >
      <div className="flex flex-col gap-4">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <ProductsSummaryCards summary={summary} copy={copy.products.summary} />
        <DataTableProducts
          storeId={selectedStore._id}
          products={productsPage.data}
          ingredients={ingredients}
          copySources={copySources}
          totalPages={productsPage.totalPages}
          total={productsPage.total}
          currentPage={page}
          searchTerm={searchTerm}
          status={status}
        />
      </div>
    </PageShell>
  );
}
