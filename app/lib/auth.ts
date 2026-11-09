import NextAuth from 'next-auth';

import Credentials from 'next-auth/providers/credentials';
import UsersDB from '../models/users';
import connectDB from './connect-db';
import { verifyPasswordTimingConstant } from './password-hashing';
import { logger } from './logger';
import { rateLimit } from './rate-limit';
import { verifyImpersonationToken } from './impersonation-token';
import { getClientIpFromHeaders } from './client-ip';
import { env } from './env';
import { normalizeLocale, type SupportedLocale } from './i18n/locales';

// Augment NextAuth's User/Session/JWT shapes with our custom fields.

declare module 'next-auth' {
  interface User {
    id?: string;
    mustChangePassword?: boolean;
    language?: SupportedLocale;
  }
  interface Session {
    user: {
      id?: string;
      mustChangePassword?: boolean;
      language?: SupportedLocale;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

type UserDoc = {
  _id: { toString(): string };
  email: string;
  name?: string;
  password: string;
  urlString?: string;
  mustChangePassword?: boolean;
  language?: SupportedLocale;
  disabledAt?: Date | null;
};

type AuthorizeCredentials = Partial<Record<'Email' | 'Password' | 'ImpersonateToken', unknown>>;

function isExpectedCredentialsFailure(error: Error): boolean {
  const data = error as Error & {
    type?: unknown;
    cause?: { err?: { name?: unknown }; [key: string]: unknown } | unknown;
  };

  if (data.name === 'CredentialsSignin') return true;
  if (data.type === 'CredentialsSignin') return true;
  if (
    data.cause &&
    typeof data.cause === 'object' &&
    'err' in data.cause &&
    data.cause.err &&
    typeof data.cause.err === 'object' &&
    'name' in data.cause.err &&
    data.cause.err.name === 'CredentialsSignin'
  ) {
    return true;
  }
  return false;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  logger: {
    error(error) {
      if (isExpectedCredentialsFailure(error)) {
        logger.info('auth rejected invalid credentials');
        return;
      }
      logger.error({ err: error }, 'nextauth error');
    },
    warn(code) {
      logger.warn({ code }, 'nextauth warning');
    },
  },
  providers: [
    Credentials({
      credentials: {
        Email: {},
        Password: {},
        // Inspect User: a short-lived signed token minted by /api/users/inspect
        // instead of an email + password pair.
        ImpersonateToken: {},
      },
      authorize: async (credentials, req) => {
        try {
          const creds = credentials as AuthorizeCredentials | undefined;

          // Inspect User. The token is the whole proof: it is signed with
          // AUTH_SECRET, lives for a minute, and was only issued after
          // /api/users/inspect checked the caller's system access and wrote the
          // audit row. Anything unverifiable falls through to `null` — never to
          // "sign in as whoever the payload claims".
          const impersonateToken =
            typeof creds?.ImpersonateToken === 'string' ? creds.ImpersonateToken : '';
          if (impersonateToken) {
            const verified = verifyImpersonationToken(impersonateToken);
            if (!verified) return null;

            await connectDB();
            const targetUser = (await UsersDB.findById(
              verified.targetUserId,
            ).lean()) as UserDoc | null;
            if (!targetUser || targetUser.disabledAt) return null;

            logger.info(
              { adminUserId: verified.adminUserId, targetUserId: verified.targetUserId },
              'user inspection session started',
            );

            return {
              id: targetUser._id.toString(),
              email: targetUser.email,
              name: targetUser.name,
              image: targetUser.urlString || null,
              // Not forced onto the administrator: they are borrowing the
              // account, not fixing its password.
              mustChangePassword: false,
              language: normalizeLocale(targetUser.language),
            };
          }

          const email = typeof creds?.Email === 'string' ? creds.Email : '';
          const password = typeof creds?.Password === 'string' ? creds.Password : '';
          if (!email || !password) {
            return null;
          }

          // Rate limit by IP — runs before any DB lookup. Uses the shared
          // helper so a Redis outage fails open consistently with the rest of
          // the app (see rate-limit.ts).
          const headers = (req as { headers?: Headers } | undefined)?.headers;
          const ip = headers ? getClientIpFromHeaders(headers) : 'unknown';
          const limit = env.APP_RATE_LIMIT_LOGIN_PER_MIN;
          if (await rateLimit('login', ip, limit)) {
            // Same response as bad credentials — doesn't leak state.
            return null;
          }

          await connectDB();
          // `password` is `select: false` on the schema — opt back in here,
          // this is the one place that legitimately needs the hash.
          const user = (await UsersDB.findOne({ email })
            .select('+password')
            .lean()) as UserDoc | null;

          // Always run bcrypt — even when the user is missing — so timing
          // doesn't leak whether the email exists. verifyPasswordTimingConstant
          // returns false for both "no user" and "wrong password".
          const isPassWordRight = await verifyPasswordTimingConstant(password, user?.password);

          if (!user || !isPassWordRight) {
            return null;
          }

          // A deactivated account fails exactly like a wrong password, so the
          // sign-in screen never reveals that the credentials were right.
          if (user.disabledAt) {
            return null;
          }

          // Stamped after the password check, so a failed attempt never counts as
          // activity. Deliberately not awaited into the response shape beyond this
          // point: it is one indexed write per successful login.
          await UsersDB.updateOne({ _id: user._id }, { $set: { lastSignInAt: new Date() } });

          return {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            image: user.urlString || null,
            mustChangePassword: user.mustChangePassword ?? false,
            language: normalizeLocale(user.language),
          };
        } catch (error) {
          logger.error({ err: error }, 'auth credentials provider error');
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const t = token as typeof token & {
        userId?: string;
        mustChangePassword?: boolean;
        language?: SupportedLocale;
      };
      if (user) {
        t.userId = user.id;
        t.mustChangePassword = user.mustChangePassword ?? false;
        t.language = normalizeLocale(user.language);
      }
      // Allow client-side session refresh after password change / language change
      const sessionUpdate = session as
        | { mustChangePassword?: boolean; language?: SupportedLocale }
        | undefined;
      if (trigger === 'update' && sessionUpdate?.mustChangePassword !== undefined) {
        t.mustChangePassword = sessionUpdate.mustChangePassword;
      }
      if (trigger === 'update' && sessionUpdate?.language !== undefined) {
        t.language = normalizeLocale(sessionUpdate.language);
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & {
        userId?: string;
        mustChangePassword?: boolean;
        language?: SupportedLocale;
      };
      if (session.user && t.userId) {
        session.user.id = t.userId;
        session.user.mustChangePassword = t.mustChangePassword ?? false;
        session.user.language = normalizeLocale(t.language);
      }
      return session;
    },
  },
});
