/**
 * @jest-environment node
 */
export {};

// The endpoint behind the organization scope picker on every /organization
// page. It exists because the picker used to call the System-only listing and
// answered 403 for clinic users, so the two things that matter here are: any
// signed-in session may call it, and what comes back is scoped to that session.
const requireAuthMock = jest.fn();
const parseRouteInputMock = jest.fn();
const getOrganizationOptionsForSessionMock = jest.fn();

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
  return { HttpError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/services/organizations', () => ({
  getOrganizationOptionsForSession: getOrganizationOptionsForSessionMock,
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

function request(query = '?page=1&limit=50&q=') {
  return new Request(`http://localhost/api/organizations/options${query}`);
}

describe('organization options route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
    parseRouteInputMock.mockResolvedValue({ page: 1, limit: 50, q: '' });
    getOrganizationOptionsForSessionMock.mockResolvedValue({
      done: true,
      data: [{ _id: 'org-1', name: 'Downtown Clinic' }],
      total: 1,
      page: 1,
      totalPages: 1,
    });
  });

  it('answers a signed-in session without demanding system access', async () => {
    const { GET } = await import('@/app/api/organizations/options/route');
    const res = await GET(request(), {});
    const body = (await res.json()) as { data: Array<{ name: string }> };

    expect(res.status).toBe(200);
    expect(body.data[0]?.name).toBe('Downtown Clinic');
  });

  it('delegates the scoping to the session-aware service', async () => {
    // The whole safety of an open endpoint rests on this: the service filters by
    // the caller's authorized organization ids, so the route must pass the
    // session through rather than query on its own.
    parseRouteInputMock.mockResolvedValue({ page: 2, limit: 10, q: 'down' });
    const { GET } = await import('@/app/api/organizations/options/route');

    await GET(request('?page=2&limit=10&q=down'), {});

    expect(getOrganizationOptionsForSessionMock).toHaveBeenCalledWith(
      { user: { id: 'u1' } },
      { page: 2, limit: 10, q: 'down' },
    );
  });

  it('refuses an anonymous caller', async () => {
    requireAuthMock.mockRejectedValue(
      Object.assign(new Error('Unauthorized.'), { status: 401, code: 'UNAUTHORIZED' }),
    );
    const { GET } = await import('@/app/api/organizations/options/route');

    const res = await GET(request(), {});

    expect(res.status).toBe(401);
    expect(getOrganizationOptionsForSessionMock).not.toHaveBeenCalled();
  });
});
