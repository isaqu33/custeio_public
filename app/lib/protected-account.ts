import connectDB from './connect-db';
import { env } from './env';
import { toObjectId } from './mongo-id';
import UsersDB from '@/app/models/users';

/**
 * The platform bootstrap accounts, named by `APP_USER_EMAIL` (demo/dev seed) and
 * `BOOTSTRAP_ADMIN_EMAIL` (`npm run bootstrap:admin` in production).
 *
 * These are the accounts that make an install reachable in the first place, and they
 * carry System access. They are not tenant users and nobody should be administering
 * them from the Users screen — an accidental edit there can strip an account's own
 * system access and lock the whole install out of `/system`.
 *
 * So they are kept out of every user listing and refused as the target of the
 * administrative actions. What they can still do is manage *themselves*: signing in,
 * changing their own password and editing their own profile all go through routes
 * keyed on the session's own id, which none of this touches.
 *
 * With both variables unset there is no protected account and every helper here is a
 * no-op.
 */
function protectedAccountEmails(): string[] {
  const emails = [env.APP_USER_EMAIL, env.BOOTSTRAP_ADMIN_EMAIL]
    .map((email) => email?.trim())
    .filter((email): email is string => Boolean(email));
  // Both spellings of each: the accounts were created from these same variables, but
  // a deploy that changed their casing should not quietly un-hide them.
  return [...new Set(emails.flatMap((email) => [email, email.toLowerCase()]))];
}

/** Whether `email` belongs to a protected account. Case-insensitive. */
export function isProtectedAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return protectedAccountEmails().some((candidate) => candidate.toLowerCase() === normalized);
}

/**
 * Mongo condition that hides the protected accounts from a user query. Spread it into
 * the filter — it contributes an `email` clause, or nothing at all when no protected
 * account is configured.
 */
export function protectedAccountFilter(): Record<string, unknown> {
  const emails = protectedAccountEmails();
  if (!emails.length) return {};
  return { email: { $nin: emails } };
}

/** What a route says when it refuses to act on a protected account. */
export const PROTECTED_ACCOUNT_MESSAGE = 'The platform account cannot be managed from here.';

/**
 * Whether this id belongs to a protected account.
 *
 * Hiding the accounts from the listing takes them out of reach of the UI; this takes
 * them out of reach of the id, which is what actually matters — the administrative
 * routes accept a `userId` straight from the client. Returns a boolean instead of
 * throwing so this module stays free of the error types, which drag NextAuth in with
 * them.
 */
export async function isProtectedAccountUser(userId: string): Promise<boolean> {
  if (!protectedAccountEmails().length) return false;

  await connectDB();
  const user = await UsersDB.findById(toObjectId(userId))
    .select('email')
    .lean<{ email?: string } | null>();

  return isProtectedAccountEmail(user?.email);
}
