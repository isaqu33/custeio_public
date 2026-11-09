import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { sessionHasSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { getLandingPath } from '@/app/lib/landing';

/**
 * `/organization` is a grouping, not a page.
 *
 * Same reasoning as `/system`: the sidebar parent and the breadcrumb root link
 * here, so it opens the group's first child rather than dead-ending, resolved
 * by `getLandingPath` instead of a fixed redirect.
 */
export default async function OrganizationIndexPage() {
  const session = await auth();
  if (!session) redirect('/login');
  await connectDB();
  const hasSystemAccess = await sessionHasSystemAccess(session);
  redirect(getLandingPath(hasSystemAccess ? null : new Set()) ?? '/no-access');
}
