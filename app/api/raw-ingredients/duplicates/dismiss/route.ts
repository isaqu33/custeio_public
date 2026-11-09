import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import {
  dismissDuplicateSuggestion,
  getSuggestionStoreId,
} from '@/app/lib/services/ingredient-duplicates';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { dismissDuplicate as dismissSchema } from '@/app/lib/validations';

/** "Ignorar" on a duplicate suggestion: kept as dismissed so the AI does not suggest it again. */
export const POST = withObservability<{}>(
  AppFeature.RAW_INGREDIENTS_DUPLICATES_DISMISS,
  async (req) => {
    const session = await requireAuth();
    const { id } = await parseRouteInput(req, dismissSchema);

    const storeId = await getSuggestionStoreId(id);
    if (!storeId) throw new NotFoundError('Suggestion not found.');
    const organizationId = await getStoreOrganizationId(storeId);
    if (!organizationId) throw new NotFoundError('Store not found.');
    await requireOrganizationAccess(session, organizationId);

    await dismissDuplicateSuggestion(id);
    await logAuditEvent({
      organizationId,
      actorUserId: session.user?.id,
      action: 'raw_ingredients.duplicates_dismiss',
      resourceType: 'raw_ingredient',
      resourceId: id,
      source: 'ui',
      metadata: { storeId },
    });
    return NextResponse.json({ done: true }, { status: HttpStatus.OK });
  },
);
