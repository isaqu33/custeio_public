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
import { NextResponse } from 'next/server';

// Reveals the CURRENT pending invite token again, without invalidating it —
// unlike ORGANIZATIONS_GENERATE_INVITE_TOKEN, which always mints a fresh one.
// This is safe because `inviteToken` is stored in plaintext by design (it must
// be claimable later, so it can't be a one-way hash the way a real secret
// would be) — this route only surfaces what's already sitting in the DB.
export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_VIEW_INVITE_TOKEN,
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

      const doc = await OrganizationDB.findById(toObjectId(id))
        .select('inviteToken inviteExpiresAt')
        .lean();
      if (!doc || !doc.inviteToken) {
        return NextResponse.json(
          { done: false, error: ApiErrorCode.NOT_FOUND },
          { status: HttpStatus.NOT_FOUND },
        );
      }

      return NextResponse.json(
        {
          done: true,
          data: {
            inviteToken: doc.inviteToken,
            inviteExpiresAt: doc.inviteExpiresAt?.toISOString() ?? null,
          },
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'organization invite token view failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
