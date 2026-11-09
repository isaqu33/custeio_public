import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSessionUser } from '@/app/lib/authorization';
import { ConflictError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { SEFAZ_SYNC_JOB_CONFIG, claimSefazSync } from '@/app/lib/services/nfe-sync-claim';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { syncNfeSefaz } from '@/app/lib/validations';
import JobsDB from '@/app/models/jobs';

/**
 * "Buscar na SEFAZ": enqueues `sefaz.nfe.received` in sync mode. Guarded three
 * ways against an owner hammering the button into the 20/h per-CNPJ ceiling:
 * one run at a time per store, a cooldown since the last search, and a stop while
 * SEFAZ has the CNPJ blocked or usage is near the limit (`claimSefazSync`).
 */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_SYNC_NFE_SEFAZ,
  async (req) => {
    const session = await requireAuth();
    const sessionWithUser = requireSessionUser(session);
    const { storeId } = await parseRouteInput(req, syncNfeSefaz);

    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    const running = await JobsDB.exists({
      kind: 'sefaz.nfe.received',
      'payload.storeId': storeId,
      status: { $in: ['queued', 'running'] },
    });
    if (running) throw new ConflictError('A capture is already running for this store.');

    await claimSefazSync(storeId);

    const created = await createAndEnqueueJob({
      kind: 'sefaz.nfe.received',
      organizationId,
      examId: `NFE-SYNC-${storeId}-${Date.now()}`,
      type: 'AdHoc',
      config: SEFAZ_SYNC_JOB_CONFIG,
      payload: { requestedByUserId: sessionWithUser.user.id, storeId, mode: 'sefaz' },
    });

    return NextResponse.json(
      { done: true, message: 'SEFAZ search started.', data: created },
      { status: HttpStatus.CREATED },
    );
  },
);
