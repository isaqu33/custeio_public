import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { createRawIngredientForStore } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { createRawIngredient } from '@/app/lib/validations';

export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_CREATE, async (req) => {
  const session = await requireAuth();
  const {
    storeId,
    name,
    unit,
    kind,
    isPreparation,
    currentStock,
    averageCost,
    minAlertStock,
    aliases,
    barcodes,
    purchasePack,
  } = await parseRouteInput(req, createRawIngredient);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const ingredient = await createRawIngredientForStore({
    storeId,
    name,
    unit,
    kind,
    isPreparation,
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
    action: 'raw_ingredients.create',
    resourceType: 'raw_ingredient',
    resourceId: ingredient._id,
    source: 'ui',
    metadata: { storeId, name: ingredient.name },
  });

  return NextResponse.json({ done: true, data: ingredient }, { status: HttpStatus.OK });
});
