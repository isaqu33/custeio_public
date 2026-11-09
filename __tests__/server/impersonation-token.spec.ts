/**
 * @jest-environment node
 */
export {};

// This token is a bearer credential for someone else's account: whoever holds a
// valid one becomes that user. Every case below is a way an attacker could try
// to mint one, and each must come back `null` — never a payload.
jest.mock('@/app/lib/env', () => ({ env: { AUTH_SECRET: 'test-secret-value-0123456789' } }));

import { createImpersonationToken, verifyImpersonationToken } from '@/app/lib/impersonation-token';

const NOW = 1_800_000_000_000;

describe('impersonation token', () => {
  it('round-trips the administrator and the target', () => {
    const token = createImpersonationToken({
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      now: NOW,
    });

    expect(verifyImpersonationToken(token, NOW + 1_000)).toEqual({
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      expiresAt: NOW + 60_000,
    });
  });

  it('expires one minute after it is issued', () => {
    const token = createImpersonationToken({
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      now: NOW,
    });

    expect(verifyImpersonationToken(token, NOW + 59_999)).not.toBeNull();
    expect(verifyImpersonationToken(token, NOW + 60_001)).toBeNull();
  });

  it('rejects a payload swapped for another target', () => {
    // The attack this exists to stop: take a valid token, rewrite the target id,
    // keep the signature.
    const token = createImpersonationToken({
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      now: NOW,
    });
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ adminUserId: 'admin-1', targetUserId: 'victim', expiresAt: NOW + 60_000 }),
      'utf8',
    ).toString('base64url');

    expect(verifyImpersonationToken(`${forgedPayload}.${signature}`, NOW)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = createImpersonationToken({
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      now: NOW,
    });

    jest.resetModules();
    jest.doMock('@/app/lib/env', () => ({ env: { AUTH_SECRET: 'a-completely-different-secret' } }));
    const { verifyImpersonationToken: verifyWithOtherSecret } =
      await import('@/app/lib/impersonation-token');

    expect(verifyWithOtherSecret(token, NOW)).toBeNull();
  });

  it('rejects malformed input instead of throwing', () => {
    for (const bad of ['', 'no-dot', 'a.b', '.', 'x'.repeat(200)]) {
      expect(verifyImpersonationToken(bad, NOW)).toBeNull();
    }
  });
});
