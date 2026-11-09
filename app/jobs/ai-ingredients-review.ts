import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { findDuplicateSuggestions } from '@/app/lib/services/ingredient-duplicates';
import { groupIngredientFamilies } from '@/app/lib/services/ingredient-families';
import { reviewDraftIngredients } from '@/app/lib/services/ingredient-ai-review';

/**
 * `ai.ingredients.review`: the AI looks at each unreviewed ingredient of the store (with the few menu
 * lines that look like it) and records what it is and whether the store really uses it, then looks
 * for ingredients that are the same thing under other names (suggestions the owner merges or dismisses)
 * and groups variations under their base ingredient. Resumable and
 * capped by a spending limit, so a retry after a failure only does what is left.
 */
export async function aiIngredientsReviewJob(
  payload: JobPayloadByKind['ai.ingredients.review'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const summary = await reviewDraftIngredients({
    storeId: payload.storeId,
    force: payload.force,
  });
  // Then the duplicates among everything that is in the operation (including what was just decided).
  const duplicates = await findDuplicateSuggestions({ storeId: payload.storeId, autoMerge: true });
  // Merges nobody asked for are on record: what was kept and what it absorbed.
  const organizationId = duplicates.autoMerged.length
    ? await getStoreOrganizationId(payload.storeId)
    : null;
  for (const merge of organizationId ? duplicates.autoMerged : []) {
    await logAuditEvent({
      organizationId: organizationId as string,
      resourceType: 'raw_ingredient',
      action: 'raw_ingredients.auto_merge',
      source: 'worker',
      metadata: { storeId: payload.storeId, kept: merge.kept, merged: merge.merged },
    });
  }
  // And the families ("Bacon Sadia" under "Bacon"), so the list stays one line per base ingredient.
  const families = await groupIngredientFamilies({ storeId: payload.storeId });
  return {
    kind: 'ai.ingredients.review',
    storeId: payload.storeId,
    attempt: context.attempt,
    ...summary,
    duplicates,
    families,
    completedAt: new Date().toISOString(),
  };
}
