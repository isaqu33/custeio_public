import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSessionUser } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { captureNfeInvoices } from '@/app/lib/validations';

const captureConfig = {
  attempts: 1,
  backoff: { type: 'fixed' as const, delay: 1000 },
  // Idempotent by design (ProcessedInvoices.accessKey) — kept off automatic
  // retry so a bad file fails once and shows the owner why, rather than
  // silently retrying the same parse error.
  removeOnComplete: true,
  removeOnFail: 1000,
};

/**
 * Enqueues the manual-upload NFe capture (see docs/features/sefaz-nfe.md).
 * Tenant-facing, not System-only — the store's own organization is enough,
 * same pattern as the other raw-ingredients routes.
 */
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_CAPTURE_NFE, async (req) => {
  const session = await requireAuth();
  const sessionWithUser = requireSessionUser(session);
  const { storeId, files } = await parseRouteInput(req, captureNfeInvoices);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const reference = `NFE-CAPTURE-${storeId}-${Date.now()}`;
  const created = await createAndEnqueueJob({
    kind: 'sefaz.nfe.received',
    organizationId,
    reference,
    type: 'AdHoc',
    config: captureConfig,
    payload: {
      requestedByUserId: sessionWithUser.user.id,
      storeId,
      files,
    },
  });

  return NextResponse.json(
    { done: true, message: 'Capture started.', data: created },
    { status: HttpStatus.CREATED },
  );
});
