import { AppFeature } from '@/app/lib/features';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { requireSystemAccess } from '@/app/lib/authorization';
import { withObservability } from '@/app/lib/observability';
import { getJobDetailForSession } from '@/app/lib/services/jobs';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// Single job + its conversation, for the detail modal. Org-scoped inside the
// service; an unknown/forbidden id surfaces as a 404.
export const GET = withObservability<RouteContext>(AppFeature.JOBS_GET_ONE, async (_req, ctx) => {
  const session = await requireAuth();
  // The Jobs page lives under /system, which is System/Support only. Repeated
  // here because the layout guard shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { id } = await ctx.params;
  const detail = await getJobDetailForSession(session, id);
  if (!detail) throw new NotFoundError('Job not found.');
  return NextResponse.json({ done: true, data: detail }, { status: HttpStatus.OK });
});
