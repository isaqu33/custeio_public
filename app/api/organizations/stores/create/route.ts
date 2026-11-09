import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { createStoreForOrganization } from '@/app/lib/services/stores';
import { createStore } from '@/app/lib/validations';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_CREATE_STORE, async (req) => {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const {
    organizationId,
    cnpj,
    legalName,
    name,
    whatsappNumber,
    provider,
    externalId,
    apiKey,
    imageUrl,
  } = await parseRouteInput(req, createStore);

  await requireOrganizationAccess(session, organizationId);

  const store = await createStoreForOrganization({
    organizationId,
    cnpj,
    legalName,
    name,
    whatsappNumber,
    provider,
    externalId,
    apiKey,
    imageUrl,
  });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'organization.create_store',
    resourceType: 'store',
    resourceId: store._id,
    source: 'ui',
  });

  return NextResponse.json({ done: true, data: store }, { status: HttpStatus.OK });
});
