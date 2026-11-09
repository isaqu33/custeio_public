import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import {
  createOrganizationAdminDeps,
  removeOrganizationAdmin,
} from '@/app/lib/services/organization-admin';
import { adminAction } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import UsersDB from '@/app/models/users';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_REMOVE_ADMIN,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    // Platform administration: the pages this backs all live under `/system`,
    // which is System/Support only. Repeated here because the layout guard
    // shapes the UI and this shapes the request.
    await requireSystemAccess(session);

    try {
      const { organizationId, userId } = await parseRouteInput(req, adminAction);

      await connectDB();
      await requireOrganizationAccess(session, organizationId);
      const result = await removeOrganizationAdmin(
        createOrganizationAdminDeps({ OrganizationsDB: OrganizationDB, UsersDB }),
        { organizationId, userId },
      );
      if (!result.done) {
        return NextResponse.json({ done: false, error: result.error }, { status: result.status });
      }
      return NextResponse.json({ done: true, message: result.message }, { status: HttpStatus.OK });
    } catch (err) {
      log.error({ err }, 'admin removal failed');
      return NextResponse.json(
        {
          done: false,
          error: ApiErrorCode.INTERNAL_SERVER_ERROR,
        },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
