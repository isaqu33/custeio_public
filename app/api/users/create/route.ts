import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import connectDB from '@/app/lib/connect-db';
import { requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { hashPassword } from '@/app/lib/password-hashing';
import { withObservability } from '@/app/lib/observability';
import { createUser } from '@/app/lib/validations';
import { NextResponse } from 'next/server';
import UsersDB from '../../../models/users';

export const POST = withObservability<{}>(AppFeature.USERS_CREATE, async (req, _ctx, { log }) => {
  await requireAuth();
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { name, email, password } = await parseRouteInput(req, createUser);

  try {
    await connectDB();

    const userAlreadyExists = await UsersDB.findOne({ email }).lean();

    if (userAlreadyExists) {
      return NextResponse.json(
        {
          done: false,
          message: 'User already exists with this email.',
        },
        { status: HttpStatus.CONFLICT },
      );
    }

    const hashedPassword = await hashPassword(password);

    // No system access by default: an operator grants it explicitly on the
    // user's edit form. A tenant account needs none of it either — its access
    // comes from `organizationIds`, assigned separately.
    await UsersDB.create({
      name,
      email,
      password: hashedPassword,
      organizationIds: [],
      urlString: null,
      mustChangePassword: true,
    });

    return NextResponse.json(
      {
        done: true,
        message: 'User created successfully.',
      },
      { status: HttpStatus.CREATED },
    );
  } catch (err) {
    log.error({ err }, 'user create failed');
    return NextResponse.json(
      { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
      { status: HttpStatus.INTERNAL_SERVER_ERROR },
    );
  }
});
