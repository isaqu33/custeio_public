import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { registerWaste } from '@/app/lib/services/internal-use';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { registerWaste as wasteSchema } from '@/app/lib/validations';

/**
 * "Avaria": stock that spoiled, expired, broke or arrived damaged. Goes out at the average cost, with
 * a reason, and no person.
 */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_REGISTER_WASTE,
  async (req) => {
    const session = await requireAuth();
    const input = await parseRouteInput(req, wasteSchema);

    // The store comes from the body, so it is authorized against the session before any use.
    const organizationId = await getStoreOrganizationId(input.storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const result = await registerWaste({ ...input, userId: session.user?.id });

    if (!result.duplicate) {
      await logAuditEvent({
        organizationId,
        actorUserId: session.user?.id,
        action: 'raw_ingredients.register_waste',
        resourceType: 'store',
        resourceId: input.storeId,
        source: 'ui',
        metadata: {
          storeId: input.storeId,
          reason: input.reason,
          lines: result.lines.length,
          totalValue: result.totalValue,
        },
      });
    }

    return NextResponse.json({ done: true, data: result }, { status: HttpStatus.OK });
  },
);
