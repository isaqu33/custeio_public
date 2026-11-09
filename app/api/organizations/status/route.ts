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
import { organizationId as organizationIdSchema } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_CHANGE_INACTIVITY,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    // Platform administration: the pages this backs all live under `/system`,
    // which is System/Support only. Repeated here because the layout guard
    // shapes the UI and this shapes the request.
    await requireSystemAccess(session);
    const { id } = await parseRouteInput(req, organizationIdSchema);

    try {
      await connectDB();

      // A session proves identity, not tenancy — without this any signed-in user
      // could disable any organization by id.
      await requireOrganizationAccess(session, id);

      // A plain flip between the two operational states. `onboarding` and
      // `canceled` are reached through other flows (claim, cancellation) —
      // this action only ever toggles an organization active/suspended, so
      // an org in either of those other states is activated on first toggle.
      const result = await OrganizationDB.updateOne(
        { _id: toObjectId(id) },
        [
          {
            $set: {
              status: {
                $cond: [{ $eq: ['$status', 'active'] }, 'suspended', 'active'],
              },
            },
          },
        ],
        // Mongoose 9 no longer infers an aggregation pipeline from an array
        // update; it refuses one outright unless the intent is declared here.
        { updatePipeline: true },
      );

      if (result.matchedCount === 0) {
        return NextResponse.json(
          {
            done: false,
            error: ApiErrorCode.NOT_FOUND,
          },
          { status: HttpStatus.NOT_FOUND },
        );
      }

      await logAuditEvent({
        organizationId: id,
        actorUserId: session.user?.id,
        action: 'organization.toggle_status',
        resourceType: 'organization',
        resourceId: id,
        source: 'ui',
      });

      return NextResponse.json(
        {
          done: true,
          message: 'Status updated successfully.',
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'organization status update failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
