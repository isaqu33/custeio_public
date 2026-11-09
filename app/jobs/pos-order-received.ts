import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { processPosEvent } from '@/app/lib/services/order-stock';

/**
 * `pos.order.received`: one PDV delivery (already stored in `pos_events`) becomes an `Orders` row
 * and, once the store accepted the order, its recipes are taken out of stock; a cancellation gives
 * them back. Safe to run twice for the same order — see services/order-stock.ts.
 */
export async function posOrderReceivedJob(
  payload: JobPayloadByKind['pos.order.received'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const result = await processPosEvent(payload.eventId);
  return {
    kind: 'pos.order.received',
    storeId: payload.storeId,
    eventId: payload.eventId,
    attempt: context.attempt,
    ...result,
    completedAt: new Date().toISOString(),
  };
}
