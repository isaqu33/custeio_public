import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireSystemAccess, requireUserManagementAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { isProtectedAccountUser, PROTECTED_ACCOUNT_MESSAGE } from '@/app/lib/protected-account';
import { ForbiddenError, HttpError, requireAuth } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { withObservability } from '@/app/lib/observability';
import { deleteUser } from '@/app/lib/validations';
import { NextResponse } from 'next/server';
import UsersDB from '../../../models/users';

export const DELETE = withObservability<{}>(AppFeature.USERS_DELETE, async (req, _ctx, { log }) => {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { userId } = await parseRouteInput(req, deleteUser);

  // A session proves identity, not exemption — without this, anyone with
  // system access could delete their own account through this endpoint.
  if (session.user?.id === userId) {
    throw new ForbiddenError('You cannot delete your own account.');
  }

  try {
    await connectDB();
    await requireUserManagementAccess(session, userId);
    if (await isProtectedAccountUser(userId)) {
      throw new ForbiddenError(PROTECTED_ACCOUNT_MESSAGE);
    }

    await UsersDB.deleteOne({ _id: toObjectId(userId) });

    return NextResponse.json(
      {
        done: true,
        message: 'User removed successfully.',
      },
      { status: HttpStatus.OK },
    );
  } catch (err) {
    // A refusal is not a failure: without this, "you may not delete this user"
    // came back as an opaque 500 and looked like a bug in the route. The
    // wrapper maps HttpError to its own status.
    if (err instanceof HttpError) throw err;
    log.error({ err }, 'user delete failed');
    return NextResponse.json(
      { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
      { status: HttpStatus.INTERNAL_SERVER_ERROR },
    );
  }
});
