/**
 * @jest-environment node
 */
export {};

// The bootstrap accounts named by APP_USER_EMAIL (demo/dev seed) and
// BOOTSTRAP_ADMIN_EMAIL (production) are the platform's own logins, not tenant
// users. They carry System access, and an accidental edit on the Users screen can
// strip that access and lock the install out of /system — which is exactly what
// happened once. So they are hidden from the listings and refused as a target.
const envMock: { APP_USER_EMAIL?: string; BOOTSTRAP_ADMIN_EMAIL?: string } = {
  APP_USER_EMAIL: 'platform@example.com',
};
const usersFindByIdLeanMock = jest.fn();
const usersFindByIdSelectMock = jest.fn(() => ({ lean: usersFindByIdLeanMock }));
const usersFindByIdMock = jest.fn(() => ({ select: usersFindByIdSelectMock }));

jest.mock('@/app/lib/env', () => ({ env: envMock }));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { findById: usersFindByIdMock },
}));

describe('protected account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envMock.APP_USER_EMAIL = 'platform@example.com';
    delete envMock.BOOTSTRAP_ADMIN_EMAIL;
  });

  it('excludes the configured account from a user query', async () => {
    const { protectedAccountFilter } = await import('@/app/lib/protected-account');

    expect(protectedAccountFilter()).toEqual({ email: { $nin: ['platform@example.com'] } });
  });

  it('hides it whatever the casing of the stored email', async () => {
    envMock.APP_USER_EMAIL = 'Platform@Example.com';
    const { protectedAccountFilter, isProtectedAccountEmail } =
      await import('@/app/lib/protected-account');

    expect(protectedAccountFilter()).toEqual({
      email: { $nin: ['Platform@Example.com', 'platform@example.com'] },
    });
    expect(isProtectedAccountEmail('PLATFORM@example.com')).toBe(true);
  });

  it('excludes the production bootstrap account too', async () => {
    // bootstrap:admin creates this one, and it is the account a real deployment
    // signs in with — leaving it listed was the actual exposure.
    envMock.BOOTSTRAP_ADMIN_EMAIL = 'admin@clinic.example';
    const { protectedAccountFilter, isProtectedAccountEmail } =
      await import('@/app/lib/protected-account');

    expect(protectedAccountFilter()).toEqual({
      email: { $nin: ['platform@example.com', 'admin@clinic.example'] },
    });
    expect(isProtectedAccountEmail('ADMIN@clinic.example')).toBe(true);
  });

  it('protects the production account even when the seed one is unset', async () => {
    delete envMock.APP_USER_EMAIL;
    envMock.BOOTSTRAP_ADMIN_EMAIL = 'admin@clinic.example';
    const { protectedAccountFilter, isProtectedAccountEmail } =
      await import('@/app/lib/protected-account');

    expect(protectedAccountFilter()).toEqual({ email: { $nin: ['admin@clinic.example'] } });
    expect(isProtectedAccountEmail('admin@clinic.example')).toBe(true);
  });

  it('hides nobody when neither variable is set', async () => {
    // An install without the variables must behave exactly as before — an empty
    // condition, not one that filters on `undefined`.
    delete envMock.APP_USER_EMAIL;
    const { protectedAccountFilter, isProtectedAccountEmail } =
      await import('@/app/lib/protected-account');

    expect(protectedAccountFilter()).toEqual({});
    expect(isProtectedAccountEmail('anyone@example.com')).toBe(false);
  });

  it('identifies the account behind a user id', async () => {
    usersFindByIdLeanMock.mockResolvedValue({ email: 'platform@example.com' });
    const { isProtectedAccountUser } = await import('@/app/lib/protected-account');

    await expect(isProtectedAccountUser('665f735a90788d97f5a76311')).resolves.toBe(true);
  });

  it('leaves every other account alone', async () => {
    usersFindByIdLeanMock.mockResolvedValue({ email: 'doctor@clinic.example' });
    const { isProtectedAccountUser } = await import('@/app/lib/protected-account');

    await expect(isProtectedAccountUser('665f735a90788d97f5a76311')).resolves.toBe(false);
  });

  it('identifies the production bootstrap account behind a user id', async () => {
    delete envMock.APP_USER_EMAIL;
    envMock.BOOTSTRAP_ADMIN_EMAIL = 'admin@clinic.example';
    usersFindByIdLeanMock.mockResolvedValue({ email: 'admin@clinic.example' });
    const { isProtectedAccountUser } = await import('@/app/lib/protected-account');

    await expect(isProtectedAccountUser('665f735a90788d97f5a76311')).resolves.toBe(true);
  });

  it('does not even query when no account is configured', async () => {
    delete envMock.APP_USER_EMAIL;
    const { isProtectedAccountUser } = await import('@/app/lib/protected-account');

    await expect(isProtectedAccountUser('665f735a90788d97f5a76311')).resolves.toBe(false);
    expect(usersFindByIdMock).not.toHaveBeenCalled();
  });
});
