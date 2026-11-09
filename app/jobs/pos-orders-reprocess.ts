import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { reprocessIncompleteOrders } from '@/app/lib/services/order-stock';

/**
 * `pos.orders.reprocess`: settles again every debited order of the store that still has lines without a
 * recipe, against the recipes as they are now. Only the difference is written, so it is safe to run twice.
 */
export async function posOrdersReprocessJob(
  payload: JobPayloadByKind['pos.orders.reprocess'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const summary = await reprocessIncompleteOrders(payload.storeId);
  return {
    kind: 'pos.orders.reprocess',
    storeId: payload.storeId,
    attempt: context.attempt,
    ...summary,
    completedAt: new Date().toISOString(),
  };
}
