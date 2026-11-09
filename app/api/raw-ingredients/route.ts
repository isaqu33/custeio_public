import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getRawIngredientsForStore } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { listRawIngredients } from '@/app/lib/validations';

/**
 * The Estoque page's list. Tenant-facing — `RawIngredients` is store data, so
 * the client only sends the store's own id; its owning organization is
 * resolved here before it is trusted for the access check, same pattern as
 * the Stores update/delete routes.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  const { storeId } = await parseRouteInput(req, listRawIngredients);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const data = await getRawIngredientsForStore(storeId);
  return NextResponse.json({ done: true, data }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.RAW_INGREDIENTS_GET_ALL, handler);
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_GET_ALL, handler);
