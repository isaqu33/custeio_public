import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getStoreOptionsForSession } from '@/app/lib/services/stores';
import { listStoreOptions } from '@/app/lib/validations';

/**
 * The stores the signed-in session may pick from — id, name, owning
 * organization. Deliberately not `/api/organizations/stores`: that one backs
 * the System store table and is System/Support only, so a tenant session on
 * the Estoque page got a 403 and an empty picker. Here the tenant boundary is
 * the answer rather than the gate, same reasoning as `/api/organizations/options`.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  const { organizationId } = await parseRouteInput(req, listStoreOptions);
  const data = await getStoreOptionsForSession(session, { organizationId });
  return NextResponse.json({ done: true, data }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_STORE_OPTIONS, handler);
export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_STORE_OPTIONS, handler);
