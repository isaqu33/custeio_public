import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { resolveManualOverlap } from '@/app/lib/services/manual-overlap-resolve';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { resolveManualOverlap as resolveSchema } from '@/app/lib/validations';

/**
 * A captured invoice looks like a purchase typed in by hand: undo the manual one (the invoice
 * already carries it) or keep both. Resolve-then-authorize, and the service only acts on a
 * movement flagged on that very invoice of that store.
 */
export const POST = withObservability<{}>(AppFeature.NFE_DOCUMENTS_RESOLVE_OVERLAP, async (req) => {
  const session = await requireAuth();
  const input = await parseRouteInput(req, resolveSchema);

  const organizationId = await getStoreOrganizationId(input.storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  await resolveManualOverlap(input);

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'nfe_documents.resolve_overlap',
    resourceType: 'nfe',
    resourceId: input.accessKey,
    source: 'ui',
    metadata: { storeId: input.storeId, movementId: input.movementId, resolution: input.action },
  });

  return NextResponse.json({ done: true }, { status: HttpStatus.OK });
});
