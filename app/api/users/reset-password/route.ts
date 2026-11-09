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
import { hashPassword } from '@/app/lib/password-hashing';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { resetUserPassword } from '@/app/lib/validations';
import UsersDB from '@/app/models/users';

/**
 * Administrative password reset — distinct from `/api/users/password`, where a
 * user changes their own and has to prove the current one.
 *
 * The new password is always temporary: `mustChangePassword` is set so the
 * middleware pushes the user to /change-password on their next sign-in, and the
 * operator who typed it never keeps working access to the account.
 */
export const POST = withObservability<{}>(AppFeature.USERS_RESET_PASSWORD, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  await requireSystemAccess(session);
  const input = await parseRouteInput(req, resetUserPassword);

  await connectDB();
  await requireUserManagementAccess(session, input.userId);
  if (await isProtectedAccountUser(input.userId)) {
    throw new ForbiddenError(PROTECTED_ACCOUNT_MESSAGE);
  }

  const hashedPassword = await hashPassword(input.newPassword);
  const result = await UsersDB.updateOne(
    { _id: toObjectId(input.userId) },
    { $set: { password: hashedPassword, mustChangePassword: true } },
  );

  if (result.matchedCount === 0) {
    throw new NotFoundError('User not found.');
  }

  const targetUser = await UsersDB.findById(toObjectId(input.userId))
    .select('organizationIds email')
    .lean<{ organizationIds?: unknown[]; email?: string } | null>();

  // One row per organization the user belongs to: the trail is organization
  // scoped, and each tenant deserves to see that someone reset the credentials
  // of an account with access to their data.
  await Promise.all(
    (targetUser?.organizationIds ?? []).map((organizationId) =>
      logAuditEvent({
        organizationId: String(organizationId),
        actorUserId: sessionWithUser.user.id,
        action: 'users.reset_password',
        resourceType: 'user',
        resourceId: input.userId,
        source: 'ui',
        message: 'User password reset.',
        metadata: { targetEmail: targetUser?.email },
      }),
    ),
  );

  return NextResponse.json(
    { done: true, message: 'Password reset successfully.' },
    { status: HttpStatus.OK },
  );
});
