import type { JobExecutionContext, JobKind, JobPayloadByKind } from '@/app/lib/jobs/types';
import { exportUsersOrganizationsCsvJob } from './export-users-organizations';
import { exportOrganizationsCsvJob } from './export-organizations';
import { sefazNfeReceivedJob } from './sefaz-nfe-received';
import { posCatalogSyncJob } from './pos-catalog-sync';
import { posOrderReceivedJob } from './pos-order-received';
import { posOrdersReprocessJob } from './pos-orders-reprocess';
import { nfeXmlExportJob } from './nfe-xml-export';
import { aiIngredientsReviewJob } from './ai-ingredients-review';

type JobHandler<K extends JobKind> = (
  _payload: JobPayloadByKind[K],
  _context: JobExecutionContext,
) => Promise<Record<string, unknown> | void>;

export const jobRegistry: { [K in JobKind]: JobHandler<K> } = {
  'users.export.csv': exportUsersOrganizationsCsvJob,
  'organizations.export.csv': exportOrganizationsCsvJob,
  'sefaz.nfe.received': sefazNfeReceivedJob,
  'pos.catalog.sync': posCatalogSyncJob,
  'pos.order.received': posOrderReceivedJob,
  'pos.orders.reprocess': posOrdersReprocessJob,
  'nfe.xml.export': nfeXmlExportJob,
  'ai.ingredients.review': aiIngredientsReviewJob,
};
