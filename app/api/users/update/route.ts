import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import {
  requireSessionUser,
  requireSystemAccess,
  requireUserManagementAccess,
} from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { isProtectedAccountUser, PROTECTED_ACCOUNT_MESSAGE } from '@/app/lib/protected-account';
import { ForbiddenError, requireAuth } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { findSystemAccessLoss, nextSystemLevelForToggle } from '@/app/lib/services/system-access';
import { updateUser } from '@/app/lib/validations';
import { NextResponse } from 'next/server';
import UsersDB from '../../../models/users';

/**
 * Refuses an edit that would remove the caller's own system access, or the
 * last account's. Both are one-way doors: `scripts/dev/grant-system-access.ts`
 * is the only way back in.
 */
async function refuseSystemAccessLockout(
  actorUserId: string,
  userId: string,
  hasSystemAccess: boolean | undefined,
) {
  if (hasSystemAccess === undefined) return;
  const loss = await findSystemAccessLoss(UsersDB, {
    targetUserId: userId,
    actorUserId,
    nextHasSystemAccess: hasSystemAccess,
  });
  if (loss === 'self') {
    throw new ForbiddenError(
      'You cannot remove your own system access — ask another administrator.',
    );
  }
  if (loss === 'last') {
    throw new ForbiddenError(
      'This is the last account with system access; grant it to someone else first.',
    );
  }
}

export const POST = withObservability<{}>(AppFeature.USERS_UPDATE, async (req) => {
  const session = await requireAuth();
  const actorUserId = requireSessionUser(session).user.id;
  const { userId, name, email, hasSystemAccess } = await parseRouteInput(req, updateUser);

  await connectDB();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  await requireUserManagementAccess(session, userId);
  if (await isProtectedAccountUser(userId)) {
    throw new ForbiddenError(PROTECTED_ACCOUNT_MESSAGE);
  }
  await refuseSystemAccessLockout(actorUserId, userId, hasSystemAccess);

  if (email) {
    const emailExists = await UsersDB.findOne({ email, _id: { $ne: userId } }).lean();
    if (emailExists) {
      return NextResponse.json(
        {
          done: false,
          message: 'This email is already in use.',
        },
        { status: HttpStatus.CONFLICT },
      );
    }
  }

  const systemLevel =
    hasSystemAccess === undefined
      ? undefined
      : await nextSystemLevelForToggle(UsersDB, userId, hasSystemAccess);

  await UsersDB.updateOne(
    { _id: toObjectId(userId) },
    {
      $set: {
        ...(name && { name }),
        ...(email && { email }),
        ...(systemLevel !== undefined && { systemLevel }),
      },
    },
  );

  return NextResponse.json(
    {
      done: true,
      message: 'User updated successfully.',
    },
    { status: HttpStatus.OK },
  );
});
