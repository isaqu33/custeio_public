import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSessionUser } from '@/app/lib/authorization';
import { ConflictError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { claimCatalogSync } from '@/app/lib/services/catalog-sync-claim';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { syncCatalog } from '@/app/lib/validations';
import JobsDB from '@/app/models/jobs';

const syncConfig = {
  // Alloy allows 2 requests per minute per store token, and a quota refusal
  // (ours or Alloy's 429) is the one transient failure this job expects: the
  // window is 60s, so waiting 65s between attempts is what lets a retry
  // succeed. A short exponential backoff would just be refused again.
  attempts: 3,
  backoff: { type: 'fixed' as const, delay: 65_000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};

/**
 * "Sincronizar cardápio": enqueues `pos.catalog.sync` for one store. Guarded so
 * an owner cannot spend the store's Alloy quota on it by mashing the button:
 * one run at a time per store and a cooldown since the last sync
 * (`claimCatalogSync`). The job itself reserves its request from the per-minute
 * budget before calling Alloy.
 */
export const POST = withObservability<{}>(AppFeature.PRODUCTS_SYNC_CATALOG, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  const { storeId } = await parseRouteInput(req, syncCatalog);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const running = await JobsDB.exists({
    kind: 'pos.catalog.sync',
    'payload.storeId': storeId,
    status: { $in: ['queued', 'running'] },
  });
  if (running) throw new ConflictError('A catalog sync is already running for this store.');

  await claimCatalogSync(storeId);

  const created = await createAndEnqueueJob({
    kind: 'pos.catalog.sync',
    organizationId,
    examId: `CATALOG-SYNC-${storeId}-${Date.now()}`,
    type: 'AdHoc',
    config: syncConfig,
    payload: { requestedByUserId: sessionWithUser.user.id, storeId },
  });

  return NextResponse.json(
    { done: true, message: 'Catalog sync started.', data: created },
    { status: HttpStatus.CREATED },
  );
});
