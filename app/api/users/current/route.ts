import { ApiErrorCode } from '@/app/lib/api-errors';
import { auth } from '@/app/lib/auth';
import { requireSessionUser } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { AppFeature } from '@/app/lib/features';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { SupportedLocale } from '@/app/lib/i18n/locales';
import UsersDB from '../../../models/users';

export type User = {
  _id: string;
  amountTokens: string;
  name: string;
  email: string;
  urlString?: string;
  language?: SupportedLocale;
};

export const GET = withObservability<{}>(
  AppFeature.USERS_GET_BY_AUTH,
  async (_req, _ctx, { log }) => {
    const session = await auth();

    if (!session) {
      return NextResponse.json(
        { done: false, error: ApiErrorCode.UNAUTHORIZED },
        { status: HttpStatus.UNAUTHORIZED },
      );
    }

    try {
      const userId = requireSessionUser(session).user.id;
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return NextResponse.json(
          { done: false, error: ApiErrorCode.UNAUTHORIZED },
          { status: HttpStatus.UNAUTHORIZED },
        );
      }

      await connectDB();

      const result = (await UsersDB.findOne({
        _id: new mongoose.Types.ObjectId(userId),
      })
        .select('-password')
        .lean()) as User | null;

      return NextResponse.json(
        {
          data: {
            ...result,
            _id: result?._id.toString(),
          },
          done: true,
          message: 'OK',
        },
        { status: HttpStatus.OK },
      );
    } catch (err) {
      log.error({ err }, 'current user lookup failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
