import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import {
  countRawIngredientStock,
  getRawIngredientStoreId,
} from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { countRawIngredientStock as countStockSchema } from '@/app/lib/validations';

/**
 * "Contar estoque": the owner counted the shelf, this is the balance. The
 * difference is kept in the ledger as an adjustment and purchases add on top of
 * it from here on.
 */
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_COUNT_STOCK, async (req) => {
  const session = await requireAuth();
  const { id, countedStock, note } = await parseRouteInput(req, countStockSchema);

  const storeId = await getRawIngredientStoreId(id);
  if (!storeId) throw new NotFoundError('Ingredient not found.');
  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const ingredient = await countRawIngredientStock({
    id,
    countedStock,
    note,
    userId: session.user?.id,
  });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.count_stock',
    resourceType: 'raw_ingredient',
    resourceId: id,
    source: 'ui',
    metadata: { storeId, name: ingredient.name, countedStock },
  });

  return NextResponse.json({ done: true, data: ingredient }, { status: HttpStatus.OK });
});
