import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import connectDB from '@/app/lib/connect-db';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import UsersDB from '@/app/models/users';
import { SignOutButton } from './sign-out-button';

/**
 * Where a signed-in session lands once its account is deactivated or deleted.
 *
 * It lives outside `(protected)` on purpose: `proxy.ts` only checks that a
 * session cookie exists, so sending such a user to `/login` would bounce them
 * straight back to `/` and loop. This page renders without touching any
 * authorization helper (those refuse deactivated accounts) and offers the one
 * thing that helps — signing out.
 */
export default async function AccountInactivePage() {
  const session = await auth();
  if (!session?.user?.id) return redirect('/login');

  await connectDB();
  const user = await UsersDB.findById(session.user.id)
    .select('disabledAt')
    .lean<{ disabledAt?: Date | null } | null>();
  // An account that is fine has no business here (a stale bookmark, or it was
  // just reactivated) — send it back rather than leave a dead end.
  if (user && !user.disabledAt) return redirect('/');

  const copy = await getServerCopyForSession(session);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold">{copy.accountInactive.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.accountInactive.description}</p>
        <SignOutButton label={copy.navigation.signOut} />
      </div>
    </main>
  );
}
