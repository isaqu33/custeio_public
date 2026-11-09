/**
 * @jest-environment node
 */
export {};

const authMock = jest.fn();
const connectDBMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const requireSystemAccessMock = jest.fn();
const organizationFindByIdMock = jest.fn();

jest.mock('@/app/lib/auth', () => ({ auth: authMock }));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/authorization', () => ({
  requireOrganizationAccess: requireOrganizationAccessMock,
  requireSystemAccess: requireSystemAccessMock,
}));
jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: { findById: organizationFindByIdMock, deleteOne: jest.fn() },
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { updateMany: jest.fn() },
}));
jest.mock('@/app/lib/observability', () => ({
  withObservability:
    (
      _name: string,
      handler: (_req: Request, _ctx: unknown, _obs: { log: unknown }) => Promise<Response>,
    ) =>
    async (_req: Request, _ctx: unknown) => {
      try {
        return await handler(_req, _ctx, {
          log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        });
      } catch (err) {
        const e = err as { status?: number; code?: string; issues?: unknown[] };
        if (Array.isArray(e.issues)) {
          return new Response(JSON.stringify({ done: false, error: 'INVALID_INPUT' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ done: false, error: e.code || 'INTERNAL_SERVER_ERROR' }),
          {
            status: e.status || 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
    },
}));

describe('organizations routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
  });

  it('DELETE /api/organizations/delete returns 401 when session is missing', async () => {
    authMock.mockResolvedValueOnce(null);
    const { DELETE } = await import('@/app/api/organizations/delete/route');
    const req = new Request('http://localhost/api/organizations/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '665f735a90788d97f5a76311' }),
    });
    const res = await DELETE(req, {});
    expect(res.status).toBe(401);
  });

  it('DELETE /api/organizations/delete validates id contract (id)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u1' } });
    const { DELETE } = await import('@/app/api/organizations/delete/route');
    const req = new Request('http://localhost/api/organizations/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Id: '665f735a90788d97f5a76311' }),
    });
    const res = await DELETE(req, {});
    expect(res.status).toBe(400);
  });
});
