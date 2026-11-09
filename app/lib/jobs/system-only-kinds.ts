/**
 * Ad-hoc report jobs that only System/Support may create, list or download.
 *
 * These are not a tenant's work. Each one spans **every organization the
 * requester could reach** — for a System account, that is the whole platform,
 * plus every user with no organization at all, which is the administrators
 * themselves.
 *
 * Three things make a merely *visible* row a leak:
 *
 * - The job is stamped with a single arbitrary organization id at creation
 *   (`authorizedOrganizationIds[0]`), so a platform-wide report lands in some
 *   tenant's scope by accident of ordering.
 * - `jobs.download` serves the finished CSV to anyone who can reach the row.
 * - For the inline variants the CSV rides in the row itself (`result.csvBase64`).
 *
 * Enforced in `app/api/jobs/create/route.ts` (creation), `app/lib/services/jobs.ts`
 * (listing), and the `[id]` detail and download routes. The Jobs table hides the
 * matching controls, but the server checks are the ones that count.
 *
 * The whole Jobs page is System/Support only (`/system/jobs`) now, but this
 * list still matters: it is what keeps a platform-wide report out of a
 * tenant-scoped query, not just off a tenant's screen.
 */
export const SYSTEM_ONLY_JOB_KINDS: readonly string[] = [
  'users.export.csv',
  'organizations.export.csv',
  // PLATFORM BILLING (Phase 2)
  'billing.export.csv',
  // The runs of a scheduled task of the platform (workers' crons): they belong to no organization.
  'cron.sefaz.auto-sync',
  'cron.queue.cleanup',
  'cron.bridge.pull',
];

export function isSystemOnlyJobKind(kind: unknown): boolean {
  return SYSTEM_ONLY_JOB_KINDS.includes(String(kind));
}
