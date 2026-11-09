import { auth } from '@/app/lib/auth';
import { requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { redirect } from 'next/navigation';

/**
 * Everything under System is platform administration: branding, tenants, users,
 * groups, the chat-tester bench. None of it is group-managed — no group can
 * grant its way in, which is the point of having a bypass level at all.
 *
 * A layout rather than a check per page, so a route added under here is guarded
 * the moment it exists, and so client components that cannot read a session
 * (the medical viewer) are covered by their parent.
 *
 * Redirects rather than rendering a denial: unlike an `/organization` page,
 * where "you are missing this permission" is useful feedback a group owner can
 * act on, System is not a place a regular account is ever meant to reach. `/`
 * resolves where they *can* go, so they land somewhere usable instead of on a
 * wall.
 */
export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');
  await connectDB();

  try {
    await requireSystemAccess(session);
  } catch {
    redirect('/');
  }

  return children;
}
