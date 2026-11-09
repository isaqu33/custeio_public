import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSessionUser } from '@/app/lib/authorization';
import { BadRequestError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { env } from '@/app/lib/env';
import { HttpStatus } from '@/app/lib/http-status';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { reviewIngredients as reviewIngredientsSchema } from '@/app/lib/validations';

/** "Analisar com IA": hands the store's unreviewed ingredients to the worker; returns at once. */
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_AI_REVIEW, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  const { storeId, force } = await parseRouteInput(req, reviewIngredientsSchema);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);
  if (!env.ANTHROPIC_API_KEY) throw new BadRequestError('The AI review is not configured.');

  const created = await createAndEnqueueJob({
    kind: 'ai.ingredients.review',
    organizationId,
    reference: `INGREDIENTS-AI-REVIEW-${storeId}-${Date.now()}`,
    type: 'AdHoc',
    payload: { requestedByUserId: sessionWithUser.user.id, storeId, force },
  });
  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.ai_review',
    resourceType: 'raw_ingredient',
    source: 'ui',
    metadata: { storeId, force: Boolean(force) },
  });
  return NextResponse.json(
    { done: true, message: 'Review started.', data: created },
    { status: HttpStatus.CREATED },
  );
});
