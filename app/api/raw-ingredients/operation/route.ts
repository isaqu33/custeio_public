import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { setInOperationForStore } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { setOperationBulk as setOperationSchema } from '@/app/lib/validations';

/**
 * "Fora / na operação" for several ingredients: the picked ids, or a whole list. The client names a
 * store: resolve its organization before trusting it belongs to something this session may touch.
 */
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_SET_OPERATION, async (req) => {
  const session = await requireAuth();
  const { storeId, inOperation, ids, filters } = await parseRouteInput(req, setOperationSchema);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const changed = await setInOperationForStore({ storeId, inOperation, ids, filters });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.set_operation',
    resourceType: 'raw_ingredient',
    source: 'ui',
    metadata: { storeId, inOperation, changed, scope: ids ? 'ids' : 'list', filters },
  });
  return NextResponse.json({ done: true, data: { changed } }, { status: HttpStatus.OK });
});
