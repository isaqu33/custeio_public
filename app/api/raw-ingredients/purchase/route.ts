import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { registerManualPurchase } from '@/app/lib/services/manual-purchase';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { registerManualPurchase as registerPurchaseSchema } from '@/app/lib/validations';

/**
 * "Registrar compra": a purchase the owner types in when its note cannot be captured. The client
 * names a store: resolve its organization before trusting it belongs to something this session
 * may touch (every ingredient is then checked against that same store by the service).
 */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_REGISTER_PURCHASE,
  async (req) => {
    const session = await requireAuth();
    const input = await parseRouteInput(req, registerPurchaseSchema);

    const organizationId = await getStoreOrganizationId(input.storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const result = await registerManualPurchase({ ...input, userId: session.user?.id });

    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'raw_ingredients.register_purchase',
      resourceType: 'raw_ingredient',
      source: 'ui',
      metadata: {
        storeId: input.storeId,
        supplierName: input.supplierName,
        lines: input.lines.length,
        applied: result.applied,
        total: result.total,
      },
    });

    return NextResponse.json({ done: true, data: result }, { status: HttpStatus.OK });
  },
);
