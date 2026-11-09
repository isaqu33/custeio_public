/**
 * @jest-environment node
 */

import type { Session } from 'next-auth';

const findByIdMock = jest.fn();
const organizationsFindMock = jest.fn();

class TestUnauthorizedError extends Error {
  readonly status = 401;
  readonly code = 'UNAUTHORIZED';
  constructor(message = 'Unauthorized.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

class TestForbiddenError extends Error {
  readonly status = 403;
  readonly code = 'FORBIDDEN';
  constructor(message = 'Forbidden.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// Every check calls connectDB(); without this the suite dials a real Mongo.
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('@/app/lib/errors', () => ({
  UnauthorizedError: TestUnauthorizedError,
  ForbiddenError: TestForbiddenError,
}));

jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: {
    findById: findByIdMock,
  },
}));

jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: {
    exists: jest.fn(),
    find: organizationsFindMock,
  },
}));

function sessionWithUser(user: Record<string, unknown>): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user,
  } as Session;
}

describe('authorization session user boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts sessions with id', async () => {
    const { getAuthorizedOrganizationIds } = await import('@/app/lib/authorization');
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ organizationIds: ['org-1'] }),
      }),
    });

    const ids = await getAuthorizedOrganizationIds(sessionWithUser({ id: 'user-1' }));

    expect(findByIdMock).toHaveBeenCalledWith('user-1');
    expect(ids).toEqual(['org-1']);
  });

  it('rejects a deactivated account even though its session cookie is still valid', async () => {
    const { getAuthorizedOrganizationIds, requireSystemAccess } =
      await import('@/app/lib/authorization');
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          organizationIds: ['org-1'],
          systemLevel: ['support'],
          disabledAt: new Date(),
        }),
      }),
    });

    await expect(getAuthorizedOrganizationIds(sessionWithUser({ id: 'user-1' }))).rejects.toThrow(
      TestUnauthorizedError,
    );
    await expect(requireSystemAccess(sessionWithUser({ id: 'user-1' }))).rejects.toThrow(
      TestUnauthorizedError,
    );
  });

  it('returns every organization for system users', async () => {
    const { getAuthorizedOrganizationIds } = await import('@/app/lib/authorization');
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ organizationIds: [], systemLevel: ['system'] }),
      }),
    });
    organizationsFindMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'org-1' }, { _id: 'org-2' }]),
      }),
    });

    const ids = await getAuthorizedOrganizationIds(sessionWithUser({ id: 'system-user' }));

    expect(ids).toEqual(['org-1', 'org-2']);
  });

  it('returns the canonical id session shape', async () => {
    const { getAuthorizedOrganizationIds, requireSessionUser } =
      await import('@/app/lib/authorization');
    const session = sessionWithUser({ id: 'user-2' });
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ organizationIds: ['org-2'] }),
      }),
    });

    const requiredSession = requireSessionUser(session);
    const ids = await getAuthorizedOrganizationIds(session);

    expect(requiredSession.user.id).toBe('user-2');
    expect(findByIdMock).toHaveBeenCalledWith('user-2');
    expect(ids).toEqual(['org-2']);
  });

  it('rejects old _id-only session shape', async () => {
    const { requireSessionUser } = await import('@/app/lib/authorization');

    expect(() => requireSessionUser(sessionWithUser({ _id: 'user-1' }))).toThrow(
      TestUnauthorizedError,
    );
  });

  it('rejects sessions without a usable user id', async () => {
    const { requireSessionUser } = await import('@/app/lib/authorization');

    expect(() => requireSessionUser(sessionWithUser({ email: 'admin@example.com' }))).toThrow(
      TestUnauthorizedError,
    );
  });
});
