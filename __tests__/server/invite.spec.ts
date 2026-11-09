/**
 * @jest-environment node
 */
export {};

import {
  INVITE_TOKEN_PATTERN,
  INVITE_TTL_MS,
  inviteExpiryFrom,
  isInviteOpen,
  newInviteToken,
} from '@/app/lib/invite';

describe('invite helpers', () => {
  it('issues a token our own pattern accepts', () => {
    expect(INVITE_TOKEN_PATTERN.test(newInviteToken())).toBe(true);
  });

  it('never issues the same token twice', () => {
    expect(newInviteToken()).not.toBe(newInviteToken());
  });

  it('expires an invite seven days from now', () => {
    const now = new Date('2026-09-21T12:00:00Z');
    expect(inviteExpiryFrom(now).getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is open before its expiry and closed at or after it', () => {
    const expiry = new Date('2026-09-28T12:00:00Z');
    expect(isInviteOpen(expiry, new Date('2026-09-28T11:59:59Z'))).toBe(true);
    expect(isInviteOpen(expiry, expiry)).toBe(false);
    expect(isInviteOpen(expiry, new Date('2026-09-29T00:00:00Z'))).toBe(false);
  });

  it('treats an invite with no expiry as open-ended', () => {
    expect(isInviteOpen(undefined)).toBe(true);
    expect(isInviteOpen(null)).toBe(true);
  });
});
