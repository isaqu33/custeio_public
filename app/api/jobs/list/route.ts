import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { requireAuth } from '@/app/lib/errors';
import { requireSystemAccess } from '@/app/lib/authorization';
import { withObservability } from '@/app/lib/observability';
import { getJobsListForSession } from '@/app/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const getJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).default(''),
  searchType: z.string().max(40).default(''),
  kind: z.string().default('all'),
  organizationId: z.string().default('all'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

async function handler(req: Request) {
  const session = await requireAuth();
  // The Jobs page lives under /system, which is System/Support only. Repeated
  // here because the layout guard shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { page, limit, q, searchType, kind, organizationId, dateFrom, dateTo } =
    await parseRouteInput(req, getJobsQuerySchema);
  const result = await getJobsListForSession(session, {
    page,
    limit,
    q,
    searchType,
    kind,
    organizationId,
    dateFrom,
    dateTo,
  });
  return NextResponse.json(
    {
      ...result,
      message: 'OK',
    },
    { status: HttpStatus.OK },
  );
}

export const GET = withObservability<{}>(AppFeature.JOBS_GET_ALL, handler);
export const POST = withObservability<{}>(AppFeature.JOBS_GET_ALL, handler);
