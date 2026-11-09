import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { requireAuth } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { organizationId as organizationIdSchema } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import UsersDB from '@/app/models/users';
import { NextResponse } from 'next/server';

export const DELETE = withObservability<{}>(
  AppFeature.ORGANIZATIONS_DELETE,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    // Platform administration: the pages this backs all live under `/system`,
    // which is System/Support only. Repeated here because the layout guard
    // shapes the UI and this shapes the request.
    await requireSystemAccess(session);
    const { id } = await parseRouteInput(req, organizationIdSchema);

    try {
      await connectDB();
      await requireOrganizationAccess(session, id);

      const organization = await OrganizationDB.findById(toObjectId(id));

      if (!organization) {
        return NextResponse.json(
          {
            done: false,
            message: 'Organization not found.',
          },
          { status: HttpStatus.NOT_FOUND },
        );
      }

      await OrganizationDB.deleteOne({ _id: organization._id });

      // Pulls the deleted org from every user who references it, not only
      // admins — a plain scoped member's `organizationIds` would otherwise be
      // left pointing at a tenant that no longer exists.
      await UsersDB.updateMany(
        { organizationIds: organization._id },
        { $pull: { organizationIds: organization._id } },
      );

      return NextResponse.json(
        {
          done: true,
          message: 'Organization removed successfully.',
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'organization delete failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
