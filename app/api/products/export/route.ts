import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { csvFileName, csvResponse, toCsv } from '@/app/lib/csv';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getAllProductsForStore } from '@/app/lib/services/products';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { exportProducts } from '@/app/lib/validations';

const HEADER = [
  'Produto',
  'Categoria',
  'Código PDV',
  'Preço (R$)',
  'Preço promocional (R$)',
  'Custo (R$)',
  'Margem (R$)',
  'Margem (%)',
  'Itens na ficha técnica',
  'Custo incompleto',
  'Complementos',
  'Ativo',
  'ID Alloy',
];

/**
 * The Produtos table as a spreadsheet: everything the filters match, not just
 * the visible page. Cost and margin are empty (not 0) for a product with no
 * recipe yet.
 */
export const GET = withObservability<{}>(AppFeature.PRODUCTS_EXPORT_CSV, async (req) => {
  const session = await requireAuth();
  const { storeId, q, status } = await parseRouteInput(req, exportProducts);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const products = await getAllProductsForStore(storeId, { q, status: status ?? 'active' });
  const csv = toCsv(
    HEADER,
    products.map((product) => [
      product.name,
      product.categoryName,
      product.codPdv,
      product.sellingPrice,
      product.promotionalPrice,
      product.cost,
      product.margin,
      product.marginPercent,
      product.recipe.length,
      product.recipe.length > 0 ? product.costIncomplete : undefined,
      product.modifiersCount,
      product.isActive,
      product.externalId,
    ]),
  );

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'products.export',
    resourceType: 'store',
    resourceId: storeId,
    source: 'ui',
    metadata: { rows: products.length, search: q ?? '', status: status ?? 'active' },
  });

  return csvResponse(csv, csvFileName('produtos'));
});
