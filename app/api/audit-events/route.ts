import { parseRouteInput } from '@/app/lib/api-route';
import { AppFeature } from '@/app/lib/features';
import { requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { requireSystemAccess } from '@/app/lib/authorization';
import { withObservability } from '@/app/lib/observability';
import { listAuditEventsForSession } from '@/app/lib/services/audit-events';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const getAuditEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  organizationId: z.string().default('all'),
  action: z.string().default('all'),
  actor: z.string().max(200).default(''),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

async function handler(req: Request) {
  const session = await requireAuth();
  // Platform administration: repeated here because the layout guard shapes the
  // UI and this shapes the request.
  await requireSystemAccess(session);
  const { page, limit, organizationId, action, actor, dateFrom, dateTo } = await parseRouteInput(
    req,
    getAuditEventsQuerySchema,
  );
  const result = await listAuditEventsForSession(session, {
    page,
    limit,
    organizationId,
    action,
    actor,
    dateFrom,
    dateTo,
  });
  return NextResponse.json({ ...result, message: 'OK' }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.AUDIT_EVENTS_GET, handler);
export const POST = withObservability<{}>(AppFeature.AUDIT_EVENTS_GET, handler);
