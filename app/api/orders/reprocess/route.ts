import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSessionUser } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { reprocessOrderStock } from '@/app/lib/services/order-stock';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { reprocessOrders as reprocessOrdersSchema } from '@/app/lib/validations';

/**
 * "Reprocessar": settles an order's stock again against the recipes as they are now. With an order
 * reference it is done on the spot (one order is a handful of writes); without one it hands every
 * incomplete order of the store to the worker (`pos.orders.reprocess`). The client names a store:
 * resolve its organization before trusting it belongs to something this session may touch.
 */
export const POST = withObservability<{}>(AppFeature.ORDERS_REPROCESS, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  const { storeId, externalOrderId } = await parseRouteInput(req, reprocessOrdersSchema);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  if (externalOrderId) {
    const result = await reprocessOrderStock(storeId, externalOrderId);
    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'orders.reprocess',
      resourceType: 'order',
      resourceId: externalOrderId,
      source: 'ui',
      metadata: { storeId, result: result.action },
    });
    return NextResponse.json({ done: true, data: result }, { status: HttpStatus.OK });
  }

  const created = await createAndEnqueueJob({
    kind: 'pos.orders.reprocess',
    organizationId,
    reference: `ORDERS-REPROCESS-${storeId}-${Date.now()}`,
    type: 'AdHoc',
    payload: { requestedByUserId: sessionWithUser.user.id, storeId },
  });
  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'orders.reprocess',
    resourceType: 'order',
    source: 'ui',
    metadata: { storeId, scope: 'incomplete' },
  });
  return NextResponse.json(
    { done: true, message: 'Reprocessing started.', data: created },
    { status: HttpStatus.CREATED },
  );
});
