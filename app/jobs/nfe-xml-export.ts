import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { describeNfeXmlExport } from '@/app/lib/services/nfe-documents';

/**
 * `nfe.xml.export`: the record of one note's XML being taken from the Notas screen. The file is not
 * copied into the job (it stays in `nfe_documents`); the result says which note and how big it was.
 * The screen records it already finished (`recordNfeXmlExport`); this handler is what a retry from
 * Sistema > Jobs runs.
 */
export async function nfeXmlExportJob(
  payload: JobPayloadByKind['nfe.xml.export'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const summary = await describeNfeXmlExport(payload.storeId, payload.accessKey);
  if (!summary) throw new Error('There is no XML stored for this note.');
  return { kind: 'nfe.xml.export', attempt: context.attempt, ...summary };
}
