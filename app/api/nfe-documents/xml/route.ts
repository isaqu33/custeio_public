import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getNfeXmlForStore, recordNfeXmlExport } from '@/app/lib/services/nfe-documents';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { downloadNfeXml } from '@/app/lib/validations';

/**
 * The XML of one note we hold, as a file. Resolve-then-authorize like the other store routes: the
 * `storeId` is only trusted once its organization passed `requireOrganizationAccess`, and the
 * lookup is scoped by that store so another tenant's key finds nothing. A preview (no items) or a
 * note that came as a PDF has no XML: that is a 404, not an empty file.
 */
export const GET = withObservability<{}>(AppFeature.NFE_DOCUMENTS_DOWNLOAD_XML, async (req) => {
  const session = await requireAuth();
  const { storeId, accessKey } = await parseRouteInput(req, downloadNfeXml);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const xml = await getNfeXmlForStore(storeId, accessKey);
  if (xml === null) throw new NotFoundError('There is no XML stored for this note.');

  await recordNfeXmlExport({
    organizationId,
    storeId,
    accessKey,
    requestedByUserId: String(session.user?.id ?? ''),
    summary: { fileName: `NFe${accessKey}.xml`, bytes: Buffer.byteLength(xml, 'utf8') },
  });

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'nfe.xml_download',
    resourceType: 'nfe',
    resourceId: accessKey,
    source: 'ui',
  });

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="NFe${accessKey}.xml"`,
      'Cache-Control': 'no-store',
    },
  });
});
