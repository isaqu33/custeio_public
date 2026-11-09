/**
 * @jest-environment node
 */
export {};

// Backs the "manage users" dialog on the organizations table. Every user with
// this organization in `Users.organizationIds` is listed — there is no
// admin/member distinction, only whether the user also bypasses organization
// scope via System/Support access.
const requireAuthMock = jest.fn();
const requireSystemAccessMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const connectDBMock = jest.fn();
const parseRouteInputMock = jest.fn();

const organizationExistsMock = jest.fn();

const usersLeanMock = jest.fn();
const usersCountDocumentsMock = jest.fn();
const usersFindMock = jest.fn(() => ({
  select: () => ({
    sort: () => ({ skip: () => ({ limit: () => ({ lean: usersLeanMock }) }) }),
  }),
}));

jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  class NotFoundError extends HttpError {
    constructor(message = 'Not found.') {
      super(404, 'NOT_FOUND', message);
    }
  }
  class BadRequestError extends HttpError {
    constructor(message = 'Invalid request.') {
      super(400, 'BAD_REQUEST', message);
    }
  }
  return { HttpError, NotFoundError, BadRequestError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/authorization', () => ({
  requireSystemAccess: requireSystemAccessMock,
  requireOrganizationAccess: requireOrganizationAccessMock,
}));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/protected-account', () => ({ protectedAccountFilter: () => ({}) }));
jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: { exists: organizationExistsMock },
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { find: usersFindMock, countDocuments: usersCountDocumentsMock },
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
        const e = err as { status?: number; code?: string; message?: string };
        return new Response(JSON.stringify({ done: false, error: e.code || e.message }), {
          status: e.status || 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    },
}));

const ORG = '665f735a90788d97f5a76311';
const USER_A = '665f735a90788d97f5a76322';
const USER_B = '665f735a90788d97f5a76333';

type Row = {
  _id: string;
  bypassesOrganizationScope: boolean;
};

async function listUsers(): Promise<Row[]> {
  const { POST } = await import('@/app/api/organizations/admins/route');
  const res = await POST(
    new Request('http://localhost/api/organizations/admins', {
      method: 'POST',
      body: JSON.stringify({ id: ORG }),
    }),
    {},
  );
  const body = (await res.json()) as { data: Row[] };
  return body.data;
}

describe('organization users listing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: { id: 'admin-1' } });
    requireSystemAccessMock.mockResolvedValue(undefined);
    requireOrganizationAccessMock.mockResolvedValue(undefined);
    connectDBMock.mockResolvedValue(undefined);
    parseRouteInputMock.mockResolvedValue({ id: ORG, page: 1, limit: 20 });
    organizationExistsMock.mockResolvedValue(true);
    usersCountDocumentsMock.mockResolvedValue(2);
    usersLeanMock.mockResolvedValue([
      { _id: USER_A, name: 'Ana', email: 'ana@store.example', systemLevel: [] },
      { _id: USER_B, name: 'Bruno', email: 'bruno@store.example', systemLevel: [] },
    ]);
  });

  it('lists every linked user, with no admin/member distinction', async () => {
    const rows = await listUsers();

    expect(rows.map((row) => row._id)).toEqual([USER_A, USER_B]);
    const [query] = usersFindMock.mock.calls[0] as unknown as [{ organizationIds: unknown }];
    expect(query.organizationIds).toBeDefined();
  });

  it('flags a user who reaches every organization through system access', async () => {
    // Without this the row looks like an ordinary member, when the user
    // actually sees every tenant regardless of this link.
    usersLeanMock.mockResolvedValue([
      {
        _id: USER_B,
        name: 'Support',
        email: 'support@kairosflow.example',
        systemLevel: ['support'],
      },
    ]);

    const rows = await listUsers();

    expect(rows[0]?.bypassesOrganizationScope).toBe(true);
  });

  it('404s for an organization that does not exist', async () => {
    organizationExistsMock.mockResolvedValue(false);
    const { POST } = await import('@/app/api/organizations/admins/route');

    const res = await POST(
      new Request('http://localhost/api/organizations/admins', {
        method: 'POST',
        body: JSON.stringify({ id: ORG }),
      }),
      {},
    );

    expect(res.status).toBe(404);
  });

  it('refuses an organization the caller may not reach', async () => {
    // System access alone is not the whole answer — the tenant check still runs.
    requireOrganizationAccessMock.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
    );
    const { POST } = await import('@/app/api/organizations/admins/route');

    const res = await POST(
      new Request('http://localhost/api/organizations/admins', {
        method: 'POST',
        body: JSON.stringify({ id: ORG }),
      }),
      {},
    );

    expect(res.status).toBe(403);
    expect(usersFindMock).not.toHaveBeenCalled();
  });
});
