import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { syncCatalogForStore } from '@/app/lib/services/catalog-sync';

/**
 * `pos.catalog.sync`: mirrors the Alloy menu into `PartnerProducts` for one
 * store. Runs on demand ("Sincronizar cardápio") — never on a short interval:
 * it spends 1 of the store's 2 Alloy requests per minute.
 */
export async function posCatalogSyncJob(
  payload: JobPayloadByKind['pos.catalog.sync'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const summary = await syncCatalogForStore(payload.storeId, { jobId: context.jobId });
  return {
    kind: 'pos.catalog.sync',
    storeId: payload.storeId,
    attempt: context.attempt,
    ...summary,
    completedAt: new Date().toISOString(),
  };
}
