import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getProductStoreId, updateProductRecipe } from '@/app/lib/services/products';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { updateProductRecipe as updateProductRecipeSchema } from '@/app/lib/validations';

/**
 * Saves a product's ficha técnica. The client only sends the product's own id:
 * resolve its store, then that store's organization, before trusting it belongs
 * to something this session may touch (same pattern as raw-ingredients/update).
 */
export const POST = withObservability<{}>(AppFeature.PRODUCTS_UPDATE_RECIPE, async (req) => {
  const session = await requireAuth();
  const { id, recipe } = await parseRouteInput(req, updateProductRecipeSchema);

  const storeId = await getProductStoreId(id);
  if (!storeId) throw new NotFoundError('Product not found.');
  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const product = await updateProductRecipe({ id, recipe });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'products.update_recipe',
    resourceType: 'product',
    resourceId: id,
    source: 'ui',
    metadata: { storeId, name: product.name, lines: recipe.length },
  });

  return NextResponse.json({ done: true, data: product }, { status: HttpStatus.OK });
});
