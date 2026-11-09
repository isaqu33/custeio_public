import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { requireAuth } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { updateOrganizationBilling } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import { NextResponse } from 'next/server';

// Manual record only — there is no Asaas integration yet. This exists so
// Support can track billing state and (once an Asaas customer exists) note
// its id, without waiting on the real integration.
export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_UPDATE_BILLING,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    // Platform administration: the pages this backs all live under `/system`,
    // which is System/Support only. Repeated here because the layout guard
    // shapes the UI and this shapes the request.
    await requireSystemAccess(session);
    const { id, billingStatus, asaasCustomerId } = await parseRouteInput(
      req,
      updateOrganizationBilling,
    );

    try {
      await connectDB();
      await requireOrganizationAccess(session, id);

      const result = await OrganizationDB.updateOne(
        { _id: toObjectId(id) },
        {
          $set: {
            ...(billingStatus !== undefined && { billingStatus }),
            ...(asaasCustomerId !== undefined && { asaasCustomerId }),
          },
        },
      );

      if (result.matchedCount === 0) {
        return NextResponse.json(
          { done: false, error: ApiErrorCode.NOT_FOUND },
          { status: HttpStatus.NOT_FOUND },
        );
      }

      await logAuditEvent({
        organizationId: id,
        actorUserId: session.user?.id,
        action: 'organization.update_billing',
        resourceType: 'organization',
        resourceId: id,
        source: 'ui',
      });

      return NextResponse.json(
        { done: true, message: 'Billing updated successfully.' },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'organization billing update failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
