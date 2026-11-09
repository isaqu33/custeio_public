import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import {
  requireSessionUser,
  requireSystemAccess,
  requireUserManagementAccess,
} from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { isProtectedAccountUser, PROTECTED_ACCOUNT_MESSAGE } from '@/app/lib/protected-account';
import { ForbiddenError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { isLastActiveSystemAccount } from '@/app/lib/services/system-access';
import { setUserStatus } from '@/app/lib/validations';
import UsersDB from '@/app/models/users';

/**
 * Deactivates or reactivates an account without deleting it, so the audit trail
 * and organization links survive. A deactivated user cannot sign in, and their
 * open sessions stop working on the next authorized request (see
 * `app/lib/authorization.ts`).
 */
export const POST = withObservability<{}>(AppFeature.USERS_SET_STATUS, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  await requireSystemAccess(session);
  const { userId, disabled } = await parseRouteInput(req, setUserStatus);

  // Same reasoning as delete: a session proves identity, not exemption.
  if (disabled && sessionWithUser.user.id === userId) {
    throw new ForbiddenError('You cannot deactivate your own account.');
  }

  await connectDB();
  await requireUserManagementAccess(session, userId);
  if (await isProtectedAccountUser(userId)) {
    throw new ForbiddenError(PROTECTED_ACCOUNT_MESSAGE);
  }
  if (disabled && (await isLastActiveSystemAccount(UsersDB, userId))) {
    throw new ForbiddenError(
      'This is the last active account with system access; grant it to someone else first.',
    );
  }

  const result = await UsersDB.updateOne(
    { _id: toObjectId(userId) },
    disabled ? { $set: { disabledAt: new Date() } } : { $unset: { disabledAt: '' } },
  );
  if (result.matchedCount === 0) {
    throw new NotFoundError('User not found.');
  }

  const targetUser = await UsersDB.findById(toObjectId(userId))
    .select('organizationIds email')
    .lean<{ organizationIds?: unknown[]; email?: string } | null>();

  // One row per organization the user belongs to, as with a password reset: the
  // trail is organization scoped, and a tenant should see that an account with
  // access to its data was switched off or back on. A user with no organization
  // has nowhere to record it.
  await Promise.all(
    (targetUser?.organizationIds ?? []).map((organizationId) =>
      logAuditEvent({
        organizationId: String(organizationId),
        actorUserId: sessionWithUser.user.id,
        action: disabled ? 'users.disable' : 'users.enable',
        resourceType: 'user',
        resourceId: userId,
        source: 'ui',
        message: disabled ? 'User deactivated.' : 'User reactivated.',
        metadata: { targetEmail: targetUser?.email },
      }),
    ),
  );

  return NextResponse.json(
    { done: true, message: disabled ? 'User deactivated.' : 'User reactivated.' },
    { status: HttpStatus.OK },
  );
});
