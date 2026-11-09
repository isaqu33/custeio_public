import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import {
  getCatalogSyncAvailability,
  type CatalogSyncAvailability,
} from '@/app/lib/services/catalog-sync-claim';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { catalogSyncStatus } from '@/app/lib/validations';
import JobsDB from '@/app/models/jobs';

type CatalogSyncStatusResponse = {
  inProgress: boolean;
  // Whether "Sincronizar cardápio" may be pressed, and when it may be again.
  sync: CatalogSyncAvailability;
  lastCompleted?: {
    status: 'done' | 'failed';
    finishedAt?: string;
    products?: number;
    activeProducts?: number;
    created?: number;
    updated?: number;
    deactivated?: number;
    // The reason of a failed run, in the words the job logged.
    error?: string;
  };
};

type LastJobLean = {
  status: 'done' | 'failed';
  result?: {
    products?: number;
    activeProducts?: number;
    created?: number;
    updated?: number;
    deactivated?: number;
  };
  errorLogs?: Array<{ message?: string }>;
  progress?: { timings?: { finishedAt?: Date } };
};

async function lastCompletedSync(
  storeId: string,
): Promise<CatalogSyncStatusResponse['lastCompleted']> {
  const lastJob = await JobsDB.findOne({
    kind: 'pos.catalog.sync',
    'payload.storeId': storeId,
    status: { $in: ['done', 'failed'] },
  })
    .select('status result errorLogs progress.timings.finishedAt')
    .sort({ createdAt: -1 })
    .lean<LastJobLean | null>();
  if (!lastJob) return undefined;

  const { products, activeProducts, created, updated, deactivated } = lastJob.result ?? {};
  return {
    status: lastJob.status,
    finishedAt: lastJob.progress?.timings?.finishedAt?.toISOString(),
    products,
    activeProducts,
    created,
    updated,
    deactivated,
    error: lastJob.status === 'failed' ? lastJob.errorLogs?.at(-1)?.message : undefined,
  };
}

/**
 * Polled by the Produtos page while a sync is running, to know when to stop the
 * spinner and refresh the table; also what labels the button's cooldown.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  const { storeId } = await parseRouteInput(req, catalogSyncStatus);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const inProgress = Boolean(
    await JobsDB.exists({
      kind: 'pos.catalog.sync',
      'payload.storeId': storeId,
      status: { $in: ['queued', 'running'] },
    }),
  );

  const response: CatalogSyncStatusResponse = {
    inProgress,
    sync: await getCatalogSyncAvailability(storeId),
    lastCompleted: inProgress ? undefined : await lastCompletedSync(storeId),
  };
  return NextResponse.json({ done: true, data: response }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.PRODUCTS_SYNC_STATUS, handler);
export const POST = withObservability<{}>(AppFeature.PRODUCTS_SYNC_STATUS, handler);
