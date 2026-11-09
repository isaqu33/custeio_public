import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { updateModifierRecipe } from '@/app/lib/services/modifiers';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { updateModifierRecipe as updateModifierRecipeSchema } from '@/app/lib/validations';

/**
 * Saves a complement's ficha técnica, under its PDV code. The client names a store: resolve
 * its organization before trusting it belongs to something this session may touch.
 */
export const POST = withObservability<{}>(
  AppFeature.PRODUCTS_UPDATE_MODIFIER_RECIPE,
  async (req) => {
    const session = await requireAuth();
    const { storeId, codPdv, recipe } = await parseRouteInput(req, updateModifierRecipeSchema);

    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    await updateModifierRecipe({ storeId, codPdv, recipe });

    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'products.update_modifier_recipe',
      resourceType: 'modifier',
      resourceId: codPdv,
      source: 'ui',
      metadata: { storeId, codPdv, lines: recipe.length },
    });

    return NextResponse.json({ done: true }, { status: HttpStatus.OK });
  },
);
