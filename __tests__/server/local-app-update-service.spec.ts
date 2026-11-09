/**
 * @jest-environment node
 */
export {};

import { compareVersions, resolveLocalAppUpdate } from '@/app/lib/services/local-app-update';

describe('local app update service', () => {
  it('compares semantic versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
  });

  it('prefers token-specific update over global update', () => {
    const result = resolveLocalAppUpdate({
      currentVersion: '1.0.0',
      tokenUpdate: {
        enabled: true,
        version: '1.0.2',
        url: 'https://example.com/token.zip',
        sha256: 'b'.repeat(64),
        required: true,
      },
      globalUpdate: {
        enabled: true,
        version: '1.0.1',
        url: 'https://example.com/global.zip',
        sha256: 'a'.repeat(64),
        required: true,
      },
    });

    expect(result).toMatchObject({ version: '1.0.2', url: 'https://example.com/token.zip' });
  });

  it('does not return update when current version is already current', () => {
    const result = resolveLocalAppUpdate({
      currentVersion: '1.0.1',
      globalUpdate: {
        enabled: true,
        version: '1.0.1',
        url: 'https://example.com/global.zip',
        sha256: 'a'.repeat(64),
        required: true,
      },
    });

    expect(result).toBeNull();
  });
});
