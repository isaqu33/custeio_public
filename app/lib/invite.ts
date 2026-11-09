import crypto from 'crypto';

/** How long a freshly generated invite stays claimable. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITE_TOKEN_BYTES = 24;

/** 24 random bytes in hex — anything else cannot be a token we issued. */
export const INVITE_TOKEN_PATTERN = new RegExp(`^[a-f0-9]{${INVITE_TOKEN_BYTES * 2}}$`);

export function newInviteToken(): string {
  return crypto.randomBytes(INVITE_TOKEN_BYTES).toString('hex');
}

export function inviteExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

/**
 * Whether an invite with this expiry can still be claimed. An invite issued
 * before expiry existed has none, and counts as open-ended — an operator can
 * still revoke it.
 */
export function isInviteOpen(
  inviteExpiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return !inviteExpiresAt || inviteExpiresAt.getTime() > now.getTime();
}
