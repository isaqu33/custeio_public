import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { logger } from '@/app/lib/logger';
import { getStoreOrganizationId } from '@/app/lib/services/stores';

/**
 * Hands a recorded PDV event to the worker (`pos.order.received`), which turns it into an order
 * and debits the stock. Shared by the public webhook and the bridge pull. A failure here must not
 * fail the delivery: the event is already stored, and the reprocess can pick it up later.
 */
export async function enqueuePosOrderReceived(input: {
  storeId: string;
  eventId: string;
}): Promise<void> {
  try {
    const organizationId = await getStoreOrganizationId(input.storeId);
    if (!organizationId) return;
    await createAndEnqueueJob({
      kind: 'pos.order.received',
      organizationId,
      examId: `POS-EVENT-${input.eventId}`,
      type: 'Gateway',
      payload: { storeId: input.storeId, eventId: input.eventId },
    });
  } catch (err) {
    logger.error({ err, ...input }, 'could not enqueue pos.order.received');
  }
}
