import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { mergeRawIngredients } from '@/app/lib/services/ingredient-merge';
import { getRawIngredientStoreId } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { mergeRawIngredients as mergeSchema } from '@/app/lib/validations';

/**
 * "Juntar insumos": folds ingredients into one (the same bacon bought from two suppliers). The
 * client sends only ingredient ids — the store comes from the target, and mergeRawIngredients
 * refuses any source that is not in that same store.
 */
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_MERGE, async (req) => {
  const session = await requireAuth();
  const { targetId, sourceIds, costBasis } = await parseRouteInput(req, mergeSchema);

  const storeId = await getRawIngredientStoreId(targetId);
  if (!storeId) throw new NotFoundError('Ingredient not found.');
  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const { target, merged } = await mergeRawIngredients({ storeId, targetId, sourceIds, costBasis });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.merge',
    resourceType: 'raw_ingredient',
    resourceId: targetId,
    source: 'ui',
    metadata: { storeId, name: String(target.name), merged, sourceIds },
  });

  return NextResponse.json({ done: true, data: { merged } }, { status: HttpStatus.OK });
});
