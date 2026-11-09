import crypto from 'crypto';
import { env } from './env';

// One minute. The token is handed straight to `signIn()` by the browser that
// asked for it, so it only has to survive one redirect — anything longer is a
// reusable "become this user" credential sitting in a network log.
const TOKEN_TTL_MS = 60_000;

type ImpersonationTokenPayload = {
  adminUserId: string;
  targetUserId: string;
  expiresAt: number;
};

function getSigningSecret() {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is required for user inspection.');
  }
  return secret;
}

function encodeBase64Url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

/**
 * Creates a short-lived signed token for the Inspect User flow.
 *
 * It records both the administrator and the target user and is signed with the
 * Auth.js secret, so the login flow can verify it without server-side state.
 * Rotating `AUTH_SECRET` invalidates any outstanding token, which is the same
 * blast radius as the session cookie it leads to.
 */
export function createImpersonationToken(input: {
  adminUserId: string;
  targetUserId: string;
  now?: number;
}) {
  const payload: ImpersonationTokenPayload = {
    adminUserId: input.adminUserId,
    targetUserId: input.targetUserId,
    expiresAt: (input.now ?? Date.now()) + TOKEN_TTL_MS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

/**
 * Validates and decodes an Inspect User token.
 *
 * Returns `null` for anything malformed, expired or wrongly signed — the caller
 * must treat that as "no login", never as "sign in as whoever the payload says".
 * The signature is compared in constant time so a wrong guess leaks nothing
 * about how close it was.
 */
export function verifyImpersonationToken(
  token: string,
  now = Date.now(),
): ImpersonationTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const actual = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as ImpersonationTokenPayload;
    if (!payload.adminUserId || !payload.targetUserId || payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}
