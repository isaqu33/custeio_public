import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { registerInternalUse } from '@/app/lib/services/internal-use';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { registerInternalUse as internalUseSchema } from '@/app/lib/validations';

/**
 * "Consumo interno": something left the stock with no sale (an employee took it, a courtesy, a
 * donation). Goes out at the average cost; the entry keeps who took it.
 */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_REGISTER_INTERNAL_USE,
  async (req) => {
    const session = await requireAuth();
    const input = await parseRouteInput(req, internalUseSchema);

    // The store comes from the body, so it is authorized against the session before any use.
    const organizationId = await getStoreOrganizationId(input.storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const result = await registerInternalUse({ ...input, userId: session.user?.id });

    if (!result.duplicate) {
      await logAuditEvent({
        organizationId,
        actorUserId: session.user?.id,
        action: 'raw_ingredients.register_internal_use',
        resourceType: 'store',
        resourceId: input.storeId,
        source: 'ui',
        metadata: {
          storeId: input.storeId,
          reason: input.reason,
          personName: input.personName,
          lines: result.lines.length,
          totalValue: result.totalValue,
        },
      });
    }

    return NextResponse.json({ done: true, data: result }, { status: HttpStatus.OK });
  },
);
