import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { getStoresForOrganization } from '@/app/lib/services/stores';
import { listStores } from '@/app/lib/validations';
import { NextResponse } from 'next/server';

async function handler(req: Request) {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { organizationId } = await parseRouteInput(req, listStores);

  // Which stores an organization has is that tenant's data — scope it.
  await requireOrganizationAccess(session, organizationId);

  const data = await getStoresForOrganization(organizationId);
  return NextResponse.json({ done: true, data }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_STORES, handler);
export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_STORES, handler);
