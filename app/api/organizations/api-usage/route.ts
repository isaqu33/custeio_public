import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getApiUsageSummaryForOrganization } from '@/app/lib/services/api-usage';
import { listStores } from '@/app/lib/validations';

/**
 * The Organizations table's "API usage" read — Alloy connection/rate-limit
 * plus SEFAZ capture activity, rolled up across every Store the Organization
 * has. System/Support only, same as the Stores table it reads from.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  await requireSystemAccess(session);
  const { organizationId } = await parseRouteInput(req, listStores);

  await requireOrganizationAccess(session, organizationId);

  const data = await getApiUsageSummaryForOrganization(organizationId);
  return NextResponse.json({ done: true, data }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_API_USAGE, handler);
export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_API_USAGE, handler);
