import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { getAuthorizedOrganizationIds, hasSystemLevelAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { getLandingPath } from '@/app/lib/landing';

export default async function Home() {
  const session = await auth();
  if (!session) redirect('/login');

  await connectDB();

  // An account linked to no organization sees an empty version of every page,
  // which reads as a broken app. Send it somewhere that explains itself instead.
  // System/Support skip the check: on a fresh install there is no organization
  // yet, and they are the ones who create the first one.
  const hasSystemAccess = await hasSystemLevelAccess(session);
  const hasAccess = hasSystemAccess || (await getAuthorizedOrganizationIds(session)).length > 0;
  if (!hasAccess) redirect('/no-access');

  // Where to land is resolved, not fixed — the day a gated `/organization`
  // page exists again, a session without its feature must not dead-end here.
  // `null` is the System/Support bypass; nothing today grants a feature to
  // anyone else (see NAV_REQUIRED_FEATURE), so a real session is an empty set.
  const landing = getLandingPath(hasSystemAccess ? null : new Set());
  redirect(landing ?? '/no-access');
}
