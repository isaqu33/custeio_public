import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { listDuplicateSuggestions } from '@/app/lib/services/ingredient-duplicates';
import {
  getIngredientGroupCounts,
  getRawIngredientsPageForStore,
  type IngredientGroup,
  type IngredientKindFilter,
  type IngredientUsageFilter,
  type RawIngredientsPage,
} from '@/app/lib/services/raw-ingredients';
import {
  getRecipeIngredientOptions,
  type RecipeIngredientOption,
} from '@/app/lib/services/products';
import {
  getSupplierOptionsForStore,
  type SupplierOption,
} from '@/app/lib/services/stock-movements';
import { getStockSummaryForStore, type StockSummary } from '@/app/lib/services/stock-summary';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { logPageLoadError } from '@/app/lib/page-logging';
import { PageShell } from '@/components/page-shell';
import { Package } from 'lucide-react';
import { StockSummaryCards } from '@/components/stock-summary-cards';
import { StoreScopeSelector } from '@/components/store-scope-selector';
import { DataTableRawIngredients } from '@/components/data-table-raw-ingredients';

const KIND_FILTERS: readonly IngredientKindFilter[] = [
  'all',
  'food',
  'packaging',
  'cleaning',
  'other',
];
const GROUPS: readonly IngredientGroup[] = ['in', 'out', 'review'];
const USAGE_FILTERS: readonly IngredientUsageFilter[] = ['all', 'used', 'unused'];

export default async function Stock(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  // The organization comes from the scope bar in the page header
  // (OrganizationWorkspaceFrame), the same way audit-events/users do it.
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const requestedStoreId = getSearchParamString(searchParams, 'storeId', '');
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const kind =
    KIND_FILTERS.find((value) => value === getSearchParamString(searchParams, 'kind', 'all')) ??
    'all';
  const usage =
    USAGE_FILTERS.find((value) => value === getSearchParamString(searchParams, 'usage', 'all')) ??
    'all';
  const supplier = getSearchParamString(searchParams, 'supplier', 'all');
  // Variations ("Bacon Sadia" under "Bacon") hide behind their main one; a search, one family, or the
  // toggle shows them.
  const family = getSearchParamString(searchParams, 'family', '');
  const showVariants = getSearchParamString(searchParams, 'variants', '') === 'show';
  const hideVariants = !showVariants && !family && !searchTerm;
  // The list opens on what is part of the operation; the others are one click away.
  const group =
    GROUPS.find((value) => value === getSearchParamString(searchParams, 'group', 'in')) ?? 'in';

  let storeOptions;
  try {
    storeOptions = await getStoreOptionsForSession(session, { organizationId });
  } catch (err) {
    logPageLoadError('stock', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // A tenant's PDV integration is set up by System/Support (see
  // docs/features/pos-providers.md) — there is nowhere on this page to create
  // a Store, only to explain why it's empty.
  const [firstStoreOption] = storeOptions;
  if (!firstStoreOption) {
    return (
      <PageShell
        title={copy.pages.stock.title}
        description={copy.pages.stock.description}
        icon={Package}
      >
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{copy.rawIngredients.noStoresTitle}</p>
          <p className="text-sm text-muted-foreground">{copy.rawIngredients.noStoresDescription}</p>
        </div>
      </PageShell>
    );
  }

  // No "all" here, unlike the organization scope: an ingredient always
  // belongs to one concrete store. Missing or unauthorized falls back to the
  // first store rather than erroring, and the URL is canonicalized to match —
  // the same reasoning as the page-emptied-by-delete redirect on Users.
  const selectedStore =
    storeOptions.find((store) => store._id === requestedStoreId) ?? firstStoreOption;

  if (selectedStore._id !== requestedStoreId) {
    const params = new URLSearchParams();
    params.set('storeId', selectedStore._id);
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/stock?${params.toString()}`);
  }

  let ingredientsPage: RawIngredientsPage;
  let summary: StockSummary;
  let groupCounts: Record<IngredientGroup, number>;
  let duplicates: Awaited<ReturnType<typeof listDuplicateSuggestions>>;
  let supplierOptions: SupplierOption[];
  let purchaseIngredients: RecipeIngredientOption[];
  try {
    // No extra access check here: `selectedStore` only ever comes from
    // `storeOptions`, which `getStoreOptionsForSession` already scoped to
    // this session's authorized organizations.
    [ingredientsPage, summary, supplierOptions, purchaseIngredients, groupCounts, duplicates] =
      await Promise.all([
        getRawIngredientsPageForStore(selectedStore._id, {
          page,
          limit: 20,
          q: searchTerm,
          kind,
          usage,
          supplier,
          group,
          preparations: 'exclude',
          variants: hideVariants ? 'hide' : 'show',
          family: family || undefined,
        }),
        getStockSummaryForStore(selectedStore._id),
        getSupplierOptionsForStore(selectedStore._id),
        getRecipeIngredientOptions(selectedStore._id),
        getIngredientGroupCounts(selectedStore._id, {
          excludePreparations: true,
          excludeVariants: hideVariants,
        }),
        listDuplicateSuggestions(selectedStore._id),
      ]);
  } catch (err) {
    logPageLoadError('stock', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if the page is empty (a search narrowed the list, or the last row
  // of the page was removed). Every applied param rides along.
  if (ingredientsPage.data.length === 0 && page > 1) {
    const params = new URLSearchParams({
      storeId: selectedStore._id,
      page: String(Math.max(1, Math.min(page - 1, ingredientsPage.totalPages))),
    });
    if (searchTerm) params.set('q', searchTerm);
    if (kind !== 'all') params.set('kind', kind);
    if (usage !== 'all') params.set('usage', usage);
    if (supplier !== 'all') params.set('supplier', supplier);
    if (group !== 'in') params.set('group', group);
    if (family) params.set('family', family);
    if (showVariants) params.set('variants', 'show');
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    redirect(`/organization/stock?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.stock.title}
      description={copy.pages.stock.description}
      icon={Package}
    >
      <div className="flex flex-col gap-4">
        <StoreScopeSelector className="max-w-xs" selectedStoreName={selectedStore.name} />
        <StockSummaryCards summary={summary} copy={copy.rawIngredients.summary} />
        <DataTableRawIngredients
          storeId={selectedStore._id}
          ingredients={ingredientsPage.data}
          totalPages={ingredientsPage.totalPages}
          total={ingredientsPage.total}
          currentPage={page}
          searchTerm={searchTerm}
          kind={kind}
          usage={usage}
          supplier={supplier}
          group={group}
          family={family}
          showVariants={showVariants}
          groupCounts={groupCounts}
          duplicates={duplicates}
          supplierOptions={supplierOptions}
          purchaseIngredients={purchaseIngredients}
        />
      </div>
    </PageShell>
  );
}
