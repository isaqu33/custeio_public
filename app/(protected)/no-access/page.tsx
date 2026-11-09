import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import {
  getAuthorizedOrganizationIds,
  hasSystemLevelAccess,
  requireSessionUser,
} from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { getServerCopyForSession } from '@/app/lib/i18n/server';

/**
 * Landing page for an account that belongs to no organization.
 *
 * Every page under `/organization` and `/system` scopes its query by
 * `getAuthorizedOrganizationIds`, so such an account lands on screens that are
 * simply empty — which reads as a broken app rather than as a pending setup.
 * The email is shown so the user can quote it to whoever grants access; it is
 * the viewer's own, so nothing here widens what they can see.
 */
export default async function NoAccessPage() {
  const session = await auth();
  if (!session) redirect('/login');

  await connectDB();

  // Someone who does have access should never sit on this page — a stale link
  // or a membership granted since login sends them to the real landing. System
  // and Support bypass organization membership entirely.
  const hasAccess =
    (await hasSystemLevelAccess(session)) ||
    (await getAuthorizedOrganizationIds(session)).length > 0;
  if (hasAccess) redirect('/organization/dashboard');

  const copy = await getServerCopyForSession(session);
  const sessionUser = requireSessionUser(session).user;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <ShieldAlert className="size-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{copy.access.noAccess.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.access.noAccess.description}</p>
        <p className="text-sm text-muted-foreground">{copy.access.noAccess.whatNow}</p>

        <dl className="w-full rounded-md border bg-secondary p-4 text-left text-sm">
          <dt className="font-medium">{copy.access.noAccess.signedInAs}</dt>
          <dd className="truncate text-muted-foreground">{sessionUser.email}</dd>
          <dt className="mt-3 font-medium">{copy.access.noAccess.yourOrganizations}</dt>
          {/* Reaching this page means the account is linked to none — the list
              can only ever be empty, so it states the reason instead of
              rendering a query that always comes back with nothing. */}
          <dd className="text-muted-foreground">{copy.access.noAccess.noOrganizations}</dd>
        </dl>
      </div>
    </div>
  );
}
