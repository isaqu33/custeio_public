import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { requireAuth, ConflictError } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { updateOrganization } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_UPDATE,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    // Platform administration: the pages this backs all live under `/system`,
    // which is System/Support only. Repeated here because the layout guard
    // shapes the UI and this shapes the request.
    await requireSystemAccess(session);
    const { id, name } = await parseRouteInput(req, updateOrganization);

    try {
      await connectDB();
      await requireOrganizationAccess(session, id);

      await OrganizationDB.updateOne({ _id: toObjectId(id) }, { $set: { ...(name && { name }) } });

      await logAuditEvent({
        organizationId: id,
        actorUserId: session.user?.id,
        action: 'organization.update',
        resourceType: 'organization',
        resourceId: id,
        source: 'ui',
      });

      return NextResponse.json(
        {
          done: true,
          message: 'Organization updated successfully.',
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { done: false, message: err.message },
          { status: HttpStatus.CONFLICT },
        );
      }
      log.error({ err }, 'organization update failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
