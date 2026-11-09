/**
 * @jest-environment node
 */
export {};

describe('landing path', () => {
  it('sends a bypass account to the first page', async () => {
    const { getLandingPath } = await import('@/app/lib/landing');
    expect(getLandingPath(null)).toBe('/organization/dashboard');
  });

  it('sends a regular session to the first page too — nothing gates it today', async () => {
    const { getLandingPath } = await import('@/app/lib/landing');
    expect(getLandingPath(new Set())).toBe('/organization/dashboard');
  });
});

describe('nav feature map', () => {
  it('is empty — nothing under /organization is feature-gated today', async () => {
    const { NAV_REQUIRED_FEATURE } = await import('@/app/lib/landing');
    expect(Object.keys(NAV_REQUIRED_FEATURE)).toHaveLength(0);
  });
});
