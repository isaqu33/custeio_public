import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getStoreOrganizationId, updateStore } from '@/app/lib/services/stores';
import { updateStore as updateStoreSchema } from '@/app/lib/validations';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_UPDATE_STORE, async (req) => {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const { id, legalName, name, whatsappNumber, apiKey, imageUrl } = await parseRouteInput(
    req,
    updateStoreSchema,
  );

  // The client only sends the store's own id — resolve its organization before
  // trusting it belongs to something this session may touch.
  const organizationId = await getStoreOrganizationId(id);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const store = await updateStore({ id, legalName, name, whatsappNumber, apiKey, imageUrl });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'organization.update_store',
    resourceType: 'store',
    resourceId: id,
    source: 'ui',
  });

  return NextResponse.json({ done: true, data: store }, { status: HttpStatus.OK });
});
