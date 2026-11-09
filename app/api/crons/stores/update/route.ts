import { NextResponse } from 'next/server';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireSystemAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { AppFeature } from '@/app/lib/features';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { updateStorePolling } from '@/app/lib/services/sefaz-polling';
import { updateStorePollingSchema } from '@/app/lib/validations';

/** Turns a store's automatic "Buscar na SEFAZ" on/off or changes its interval. */
export const POST = withObservability<{}>(AppFeature.CRONS_UPDATE_STORE_POLLING, async (req) => {
  const session = await requireAuth();
  await requireSystemAccess(session);
  const { storeId, enabled, intervalMinutes } = await parseRouteInput(
    req,
    updateStorePollingSchema,
  );

  const updated = await updateStorePolling(storeId, { enabled, intervalMinutes });
  if (!updated) throw new NotFoundError('Store not found.');

  await logAuditEvent({
    organizationId: updated.organizationId,
    actorUserId: session.user?.id,
    action: 'store.sefaz_polling_update',
    resourceType: 'store',
    resourceId: storeId,
    source: 'ui',
    metadata: { enabled, intervalMinutes },
  });

  return NextResponse.json(
    { done: true, message: 'Automatic SEFAZ search updated.' },
    { status: HttpStatus.OK },
  );
});
