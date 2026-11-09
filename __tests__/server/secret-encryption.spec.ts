/**
 * @jest-environment node
 */
export {};

// Computed inline (not a top-level const) so the hoisted jest.mock() factory
// below never reads a not-yet-initialized outer variable.
jest.mock('@/app/lib/env', () => ({
  env: { APP_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
}));

import { decryptSecret, encryptSecret } from '@/app/lib/secret-encryption';

describe('secret encryption', () => {
  it('round-trips a plaintext secret', () => {
    const ciphertext = encryptSecret('alloy-loja-token-abc123');
    expect(ciphertext).not.toContain('alloy-loja-token-abc123');
    expect(decryptSecret(ciphertext)).toBe('alloy-loja-token-abc123');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const first = encryptSecret('same-plaintext');
    const second = encryptSecret('same-plaintext');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('same-plaintext');
    expect(decryptSecret(second)).toBe('same-plaintext');
  });

  it('rejects a tampered ciphertext', () => {
    const ciphertext = encryptSecret('do-not-tamper');
    const [iv, authTag, data] = ciphertext.split('.');
    const tampered = [iv, authTag, `${(data ?? '').slice(0, -2)}xx`].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects a malformed stored value', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow('Malformed encrypted secret.');
  });
});

describe('secret encryption without a configured key', () => {
  it('throws instead of silently storing plaintext', () => {
    jest.resetModules();
    jest.doMock('@/app/lib/env', () => ({ env: {} }));
    const { encryptSecret: encryptWithoutKey } = require('@/app/lib/secret-encryption');
    expect(() => encryptWithoutKey('anything')).toThrow('APP_SECRETS_ENCRYPTION_KEY');
    jest.dontMock('@/app/lib/env');
  });
});
