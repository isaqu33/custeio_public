import { env } from '@/app/lib/env';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { logger } from '@/app/lib/logger';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import JobsDB from '@/app/models/jobs';

/**
 * After a note created new draft ingredients, hands the store to the AI review (operation, families,
 * duplicates) so the owner does not have to ask for it. At most one review is queued or running per
 * store, and it never fails the capture that called it: the button still works if this does not.
 */
export async function requestIngredientsReviewAfterCapture(storeId: string): Promise<boolean> {
  try {
    if (!env.ANTHROPIC_API_KEY) return false;
    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) return false;
    const inFlight = await JobsDB.exists({
      kind: 'ai.ingredients.review',
      'payload.storeId': storeId,
      status: { $in: ['queued', 'running'] },
    });
    if (inFlight) return false;
    await createAndEnqueueJob({
      kind: 'ai.ingredients.review',
      organizationId,
      reference: `INGREDIENTS-AI-REVIEW-${storeId}-auto-${Date.now()}`,
      type: 'AdHoc',
      payload: { storeId },
    });
    return true;
  } catch (err) {
    logger.warn({ err, storeId }, 'could not queue the ingredient review after a capture');
    return false;
  }
}
