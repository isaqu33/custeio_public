/**
 * @jest-environment node
 */
export {};

const authMock = jest.fn();
const requireAuthMock = jest.fn();
const requireSessionUserMock = jest.fn((session) => session);
const requireSystemAccessMock = jest.fn();
const connectDBMock = jest.fn();
const hashPasswordMock = jest.fn();
const createOrganizationParseMock = jest.fn();
const createUserParseMock = jest.fn();

const usersFindOneMock = jest.fn();
const usersCreateMock = jest.fn();
const usersUpdateOneMock = jest.fn();
const organizationsFindOneMock = jest.fn();
const organizationsCreateMock = jest.fn();

jest.mock('@/app/lib/auth', () => ({ auth: authMock }));
jest.mock('@/app/lib/errors', () => {
  class BadRequestError extends Error {
    status: number;
    constructor(message: string) {
      super(message);
      this.status = 400;
    }
  }
  return { requireAuth: requireAuthMock, BadRequestError };
});
jest.mock('@/app/lib/authorization', () => ({
  requireSessionUser: requireSessionUserMock,
  requireSystemAccess: requireSystemAccessMock,
}));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/password-hashing', () => ({ hashPassword: hashPasswordMock }));
jest.mock('@/app/lib/validations', () => ({
  createUser: { safeParse: jest.fn(), parse: createUserParseMock },
  createOrganization: { parse: createOrganizationParseMock },
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { findOne: usersFindOneMock, create: usersCreateMock, updateOne: usersUpdateOneMock },
}));
jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: { findOne: organizationsFindOneMock, create: organizationsCreateMock },
}));
jest.mock('@/app/lib/observability', () => ({
  withObservability:
    (
      _name: string,
      handler: (_req: Request, _ctx: unknown, _obs: { log: unknown }) => Promise<Response>,
    ) =>
    async (req: Request, ctx: unknown) => {
      try {
        return await handler(req, ctx, {
          log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        });
      } catch (err) {
        const e = err as { status?: number; message?: string; issues?: unknown[] };
        if (Array.isArray(e.issues)) {
          return new Response(JSON.stringify({ done: false, error: 'INVALID_INPUT' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ done: false, error: e.message || 'Internal server error' }),
          {
            status: e.status || 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
    },
}));

describe('auth + validation boundaries on write routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  });

  it('POST /api/users/create returns 401 when session is missing', async () => {
    requireAuthMock.mockRejectedValueOnce({ status: 401, message: 'Unauthorized.' });
    const { POST } = await import('@/app/api/users/create/route');
    const req = new Request('http://localhost/api/users/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req, {});
    expect(res.status).toBe(401);
  });

  it('POST /api/users/create returns 400 for invalid payload', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1' } });
    createUserParseMock.mockImplementationOnce(() => {
      const err = new Error('bad input') as Error & { issues?: unknown[] };
      err.issues = [{ path: ['email'], message: 'Invalid email' }];
      throw err;
    });
    const { POST } = await import('@/app/api/users/create/route');
    const req = new Request('http://localhost/api/users/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bad' }),
    });
    const res = await POST(req, {});
    expect(res.status).toBe(400);
  });

  it('POST /api/users/create returns 201 for valid payload', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1' } });
    createUserParseMock.mockReturnValueOnce({
      name: 'A',
      email: 'a@a.com',
      password: '12345678',
    });
    usersFindOneMock.mockReturnValueOnce({ lean: jest.fn().mockResolvedValueOnce(null) });
    hashPasswordMock.mockResolvedValueOnce('hashed');
    usersCreateMock.mockResolvedValueOnce({});

    const { POST } = await import('@/app/api/users/create/route');
    const req = new Request('http://localhost/api/users/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'a@a.com', password: '12345678' }),
    });
    const res = await POST(req, {});
    expect(res.status).toBe(201);
    // A fresh account starts with no system access and no organization.
    expect(usersCreateMock).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: [] }));
  });

  it('POST /api/organizations/create rejects when requireAuth is missing', async () => {
    requireAuthMock.mockResolvedValueOnce(null);
    const { POST } = await import('@/app/api/organizations/create/route');
    const req = new Request('http://localhost/api/organizations/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req, {});
    expect(res.status).toBe(500);
  });
});
