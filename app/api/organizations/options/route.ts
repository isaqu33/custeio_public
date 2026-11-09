import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getOrganizationOptionsForSession } from '@/app/lib/services/organizations';

const optionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().max(200).default(''),
});

/**
 * The organizations the signed-in user may look at — id and name only.
 *
 * Deliberately not `/api/organizations/list`: that one backs the System
 * organizations table and is System/Support only, so a clinic user opening the
 * scope picker got a 403 and an empty dropdown. Here the tenant boundary is the
 * answer rather than the gate — `getOrganizationOptionsForSession` filters by
 * the caller's authorized ids (everything, for a System session), so no extra
 * permission is needed and nobody sees a tenant they could not already reach.
 */
export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_OPTIONS, async (req) => {
  const session = await requireAuth();
  const { page, limit, q } = await parseRouteInput(req, optionsQuerySchema);

  const result = await getOrganizationOptionsForSession(session, { page, limit, q });

  return NextResponse.json({ ...result, message: 'OK' }, { status: HttpStatus.OK });
});
