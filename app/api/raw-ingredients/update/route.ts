import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getRawIngredientStoreId, updateRawIngredient } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { updateRawIngredient as updateRawIngredientSchema } from '@/app/lib/validations';

export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_UPDATE, async (req) => {
  const session = await requireAuth();
  const {
    id,
    name,
    unit,
    kind,
    inOperation,
    isPreparation,
    familyOf,
    gramsPerMl,
    costBasis,
    currentStock,
    averageCost,
    minAlertStock,
    aliases,
    barcodes,
    purchasePack,
  } = await parseRouteInput(req, updateRawIngredientSchema);

  // The client only sends the ingredient's own id — resolve its store, then
  // that store's organization, before trusting it belongs to something this
  // session may touch.
  const storeId = await getRawIngredientStoreId(id);
  if (!storeId) throw new NotFoundError('Ingredient not found.');
  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const ingredient = await updateRawIngredient({
    id,
    name,
    unit,
    kind,
    inOperation,
    isPreparation,
    familyOf,
    gramsPerMl,
    costBasis,
    currentStock,
    averageCost,
    minAlertStock,
    aliases,
    barcodes,
    purchasePack,
    userId: session.user?.id,
  });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.update',
    resourceType: 'raw_ingredient',
    resourceId: id,
    source: 'ui',
    metadata: { storeId, name: ingredient.name },
  });

  return NextResponse.json({ done: true, data: ingredient }, { status: HttpStatus.OK });
});
