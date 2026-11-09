import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { registerPreparationBatch } from '@/app/lib/services/preparations';
import { getRawIngredientStoreId } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { registerPreparationBatch as batchSchema } from '@/app/lib/validations';

/** "Registrar lote": the kitchen made some of a preparation; its ingredients go out, it comes in. */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_REGISTER_BATCH,
  async (req) => {
    const session = await requireAuth();
    const { id, producedQuantity, requestId } = await parseRouteInput(req, batchSchema);

    const storeId = await getRawIngredientStoreId(id);
    if (!storeId) throw new NotFoundError('Ingredient not found.');
    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const result = await registerPreparationBatch({
      id,
      producedQuantity,
      requestId,
      userId: session.user?.id,
    });

    if (!result.duplicate) {
      await logAuditEvent({
        organizationId,
        actorUserId: session.user?.id,
        action: 'raw_ingredients.register_batch',
        resourceType: 'raw_ingredient',
        resourceId: id,
        source: 'ui',
        metadata: { storeId, producedQuantity, totalCost: result.totalCost },
      });
    }

    return NextResponse.json({ done: true, data: result }, { status: HttpStatus.OK });
  },
);
