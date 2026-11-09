import { AppFeature } from '@/app/lib/features';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { requireSessionUser } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { requireAuth } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import { comparePassword, hashPassword } from '@/app/lib/password-hashing';
import { withObservability } from '@/app/lib/observability';
import { passwordChange } from '@/app/lib/validations';
import UsersDB from '@/app/models/users';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(
  AppFeature.USERS_CHANGE_PASSWORD,
  async (req, _ctx, { log }) => {
    const session = await requireAuth();
    const userId = requireSessionUser(session).user.id;

    const raw = await req.json().catch(() => null);
    const parsed = passwordChange.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INVALID_INPUT },
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    try {
      await connectDB();

      const user = (await UsersDB.findById(toObjectId(`${userId}`))
        .select('+password')
        .lean()) as {
        password: string;
      } | null;
      if (!user) {
        return NextResponse.json(
          { done: false, error: ApiErrorCode.NOT_FOUND },
          { status: HttpStatus.NOT_FOUND },
        );
      }

      // Reject re-using the current password
      const sameAsCurrent = await comparePassword(parsed.data.newPassword, user.password);
      if (sameAsCurrent) {
        return NextResponse.json(
          { done: false, error: ApiErrorCode.BAD_REQUEST },
          { status: HttpStatus.BAD_REQUEST },
        );
      }

      const hashed = await hashPassword(parsed.data.newPassword);

      await UsersDB.updateOne(
        { _id: toObjectId(`${userId}`) },
        { $set: { password: hashed, mustChangePassword: false } },
      );

      return NextResponse.json(
        { done: true, message: 'Password changed successfully.' },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'password change failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
