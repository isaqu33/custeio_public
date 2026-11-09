import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { savePreparation } from '@/app/lib/services/preparations';
import { getRawIngredientStoreId } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { savePreparation as savePreparationSchema } from '@/app/lib/validations';

/** Saves the recipe and yield of one batch of a preparation ("Molho da Casa"). */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_SAVE_PREPARATION,
  async (req) => {
    const session = await requireAuth();
    const input = await parseRouteInput(req, savePreparationSchema);

    const storeId = await getRawIngredientStoreId(input.id);
    if (!storeId) throw new NotFoundError('Ingredient not found.');
    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    await savePreparation(input);

    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'raw_ingredients.save_preparation',
      resourceType: 'raw_ingredient',
      resourceId: input.id,
      source: 'ui',
      metadata: { storeId, lines: input.lines.length, yield: input.yield },
    });

    return NextResponse.json({ done: true }, { status: HttpStatus.OK });
  },
);
