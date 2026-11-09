import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getRawIngredientStoreId } from '@/app/lib/services/raw-ingredients';
import { listMovementsForIngredient } from '@/app/lib/services/stock-movements';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { listRawIngredientMovements } from '@/app/lib/validations';

/**
 * The history behind one ingredient's balance: every purchase (invoice, supplier,
 * date, cost, and how the price moved) and every adjustment. Same resolve-then-
 * authorize order as the other ingredient routes: ingredient → store → organization.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  const { ingredientId } = await parseRouteInput(req, listRawIngredientMovements);

  const storeId = await getRawIngredientStoreId(ingredientId);
  if (!storeId) throw new NotFoundError('Ingredient not found.');
  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const data = await listMovementsForIngredient(ingredientId);
  return NextResponse.json({ done: true, data }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.RAW_INGREDIENTS_GET_MOVEMENTS, handler);
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_GET_MOVEMENTS, handler);
