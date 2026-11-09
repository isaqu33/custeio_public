import OrganizationsDB from '@/app/models/organizations';
import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { toObjectIds } from '@/app/lib/mongo-id';

function csvEscape(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * The organizations CSV: one row per Cliente (who may own multiple Stores/CNPJs),
 * with its onboarding/billing state.
 *
 * Split from the users export on purpose. That one answers "who has an
 * account", and joined the organization names only as membership; a question
 * about the tenants themselves — who is active, who is past due — could not
 * be answered from it at all.
 */
export async function exportOrganizationsCsvJob(
  payload: JobPayloadByKind['organizations.export.csv'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const organizations = await OrganizationsDB.find({
    _id: { $in: toObjectIds(payload.authorizedOrganizationIds) },
  })
    .select('name status billingStatus createdAt')
    .sort({ name: 1 })
    .lean();

  const header = ['organization_id', 'name', 'status', 'billing_status', 'created_at'].join(',');

  const rows = organizations.map((organization) =>
    [
      csvEscape(organization._id),
      csvEscape(organization.name),
      csvEscape(organization.status ?? 'onboarding'),
      csvEscape(organization.billingStatus ?? 'up_to_date'),
      csvEscape(isoOrEmpty(organization.createdAt)),
    ].join(','),
  );

  const csv = [header, ...rows].join('\n');
  const createdAt = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    kind: 'organizations.export.csv',
    fileName: `organizations-${createdAt}.csv`,
    mimeType: 'text/csv',
    rowCount: rows.length,
    csvBase64: Buffer.from(csv, 'utf8').toString('base64'),
    generatedAt: new Date().toISOString(),
    attempt: context.attempt,
  };
}
