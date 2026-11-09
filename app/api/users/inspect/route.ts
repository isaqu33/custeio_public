import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireSessionUser, requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { isProtectedAccountUser, PROTECTED_ACCOUNT_MESSAGE } from '@/app/lib/protected-account';
import { ForbiddenError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { createImpersonationToken } from '@/app/lib/impersonation-token';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { inspectUser } from '@/app/lib/validations';
import UsersDB from '@/app/models/users';

/**
 * Issues a one-minute token that logs the caller in as another user, so support
 * can see the app exactly as that user does.
 *
 * This is the most powerful action in the product — it hands over someone
 * else's session, including access to clinical reports. Hence System/Support
 * only, a token that expires in a minute, and an audit row in every
 * organization the target belongs to *before* the token is handed out.
 */
export const POST = withObservability<{}>(AppFeature.USERS_INSPECT, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  const { userId } = await parseRouteInput(req, inspectUser);

  await connectDB();
  await requireSystemAccess(session);

  const targetUser = await UsersDB.findById(toObjectId(userId))
    .select('_id email organizationIds')
    .lean<{ _id: unknown; email?: string; organizationIds?: unknown[] } | null>();
  if (!targetUser) {
    throw new NotFoundError('User not found.');
  }
  // No signing in as the platform account: it is the one login that can undo
  // every guard around it.
  if (await isProtectedAccountUser(userId)) {
    throw new ForbiddenError(PROTECTED_ACCOUNT_MESSAGE);
  }

  await Promise.all(
    (targetUser.organizationIds ?? []).map((organizationId) =>
      logAuditEvent({
        organizationId: String(organizationId),
        actorUserId: sessionWithUser.user.id,
        action: 'users.inspect',
        resourceType: 'user',
        resourceId: userId,
        source: 'ui',
        message: 'Administrator signed in as this user.',
        metadata: { targetEmail: targetUser.email },
      }),
    ),
  );

  return NextResponse.json(
    {
      done: true,
      token: createImpersonationToken({
        adminUserId: sessionWithUser.user.id,
        targetUserId: userId,
      }),
    },
    { status: HttpStatus.OK },
  );
});
