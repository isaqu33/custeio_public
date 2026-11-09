import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { getUsersListForSession } from '@/app/lib/services/users';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const getUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).default(''),
  userSearchType: z.string().max(40).default(''),
});

async function handler(req: Request) {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const {
    page,
    limit,
    q,
    userSearchType: searchType,
  } = await parseRouteInput(req, getUsersQuerySchema);
  const result = await getUsersListForSession(session, { page, limit, q, searchType });
  return NextResponse.json(
    {
      ...result,
      message: 'OK',
    },
    { status: HttpStatus.OK },
  );
}

export const GET = withObservability<{}>(AppFeature.USERS_GET_ALL, handler);
export const POST = withObservability<{}>(AppFeature.USERS_GET_ALL, handler);
