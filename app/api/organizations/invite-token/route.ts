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
import { inviteExpiryFrom, newInviteToken } from '@/app/lib/invite';
import { organizationId as organizationIdSchema } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import { NextResponse } from 'next/server';

// Generated on demand rather than at creation — a token sitting unused from
// the moment an org is created is one more secret to leak before anyone
// actually needs it. See app/models/organizations.ts.
export const POST = withObservability<{}>(
  AppFeature.ORGANIZATIONS_GENERATE_INVITE_TOKEN,
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

      const inviteToken = newInviteToken();
      const inviteExpiresAt = inviteExpiryFrom();
      const result = await OrganizationDB.updateOne(
        { _id: toObjectId(id) },
        { $set: { inviteToken, inviteExpiresAt } },
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
        action: 'organization.generate_invite_token',
        resourceType: 'organization',
        resourceId: id,
        source: 'ui',
      });

      return NextResponse.json(
        {
          done: true,
          message: 'Invite token generated successfully.',
          data: { inviteToken, inviteExpiresAt: inviteExpiresAt.toISOString() },
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'organization invite token generation failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
