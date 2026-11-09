import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getStoreOrganizationId, runAlloyHealthCheck } from '@/app/lib/services/stores';
import { testStoreConnection } from '@/app/lib/validations';
import { NextResponse } from 'next/server';

/** "Testar conexão" on a Store — one real Alloy call, recorded onto the
 * store's status/rate-limit fields (see runAlloyHealthCheck). System/Support
 * only, same as the rest of Store management. */
export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_TEST_STORE_CONNECTION,
  async (req) => {
    const session = await requireAuth();
    await requireSystemAccess(session);
    const { id } = await parseRouteInput(req, testStoreConnection);

    const organizationId = await getStoreOrganizationId(id);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const store = await runAlloyHealthCheck(id);

    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'organization.test_store_connection',
      resourceType: 'store',
      resourceId: id,
      source: 'ui',
      metadata: { status: store.status },
    });

    return NextResponse.json({ done: true, data: store }, { status: HttpStatus.OK });
  },
);
