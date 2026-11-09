import UsersDB from '@/app/models/users';
import { protectedAccountFilter } from '@/app/lib/protected-account';
import OrganizationsDB from '@/app/models/organizations';
import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';

function csvEscape(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function organizationNamesOf(user: { organizationIds?: unknown }): string {
  if (!Array.isArray(user.organizationIds)) return '';
  return user.organizationIds
    .map((organization) => {
      if (typeof organization !== 'object' || !organization) return '';
      return (organization as { name?: string }).name ?? '';
    })
    .filter(Boolean)
    .join(' | ');
}

/**
 * The accounts CSV: who exists, where they belong, and whether they actually use
 * the system.
 *
 * There was briefly a second job for the activity view, but it produced the same rows for the same population — the only real
 * difference was two columns. Those columns live here instead, so there is one
 * account report rather than two that drift apart.
 */
export async function exportUsersOrganizationsCsvJob(
  payload: JobPayloadByKind['users.export.csv'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  const { authorizedOrganizationIds } = payload;

  const users = await UsersDB.find({
    $or: [
      { organizationIds: { $size: 0 } },
      { organizationIds: { $in: authorizedOrganizationIds } },
    ],
    // Same account the Users screen hides: it is the platform's own login, not
    // one of the accounts this report is about.
    ...protectedAccountFilter(),
  })
    .populate({ path: 'organizationIds', model: OrganizationsDB, select: 'name' })
    // Newest sign-in first: the accounts in use lead, the dormant ones collect at
    // the bottom, which is the question this report exists to answer.
    .sort({ lastSignInAt: -1, name: 1 })
    .lean();

  const header = [
    'user_id',
    'name',
    'email',
    'last_sign_in_at',
    'has_signed_in',
    'must_change_password',
    'organizations',
  ].join(',');

  const rows = users.map((user) => {
    const lastSignInAt = user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : '';
    return [
      csvEscape(user._id),
      csvEscape(user.name),
      csvEscape(user.email),
      csvEscape(lastSignInAt),
      csvEscape(lastSignInAt ? 'true' : 'false'),
      csvEscape(user.mustChangePassword ? 'true' : 'false'),
      csvEscape(organizationNamesOf(user) || 'No Organization'),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const createdAt = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    kind: 'users.export.csv',
    fileName: `users-accounts-${createdAt}.csv`,
    mimeType: 'text/csv',
    rowCount: rows.length,
    csvBase64: Buffer.from(csv, 'utf8').toString('base64'),
    generatedAt: new Date().toISOString(),
    attempt: context.attempt,
  };
}
