/**
 * @jest-environment node
 */
export {};

// The store picker on the Estoque page. Same shape as organizations-options-route:
// any signed-in session may call it, scoped by the session-aware service.
const requireAuthMock = jest.fn();
const parseRouteInputMock = jest.fn();
const getStoreOptionsForSessionMock = jest.fn();

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
jest.mock('@/app/lib/services/stores', () => ({
  getStoreOptionsForSession: getStoreOptionsForSessionMock,
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

function request(query = '') {
  return new Request(`http://localhost/api/organizations/stores/options${query}`);
}

describe('store options route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
    parseRouteInputMock.mockResolvedValue({ organizationId: undefined });
    getStoreOptionsForSessionMock.mockResolvedValue([
      { _id: 'store-1', name: 'Loja Centro', organizationId: 'org-1' },
    ]);
  });

  it('answers a signed-in session without demanding system access', async () => {
    const { GET } = await import('@/app/api/organizations/stores/options/route');
    const res = await GET(request(), {});
    const body = (await res.json()) as { data: Array<{ name: string }> };

    expect(res.status).toBe(200);
    expect(body.data[0]?.name).toBe('Loja Centro');
  });

  it('passes the organization narrowing through to the service', async () => {
    parseRouteInputMock.mockResolvedValue({ organizationId: 'org-1' });
    const { GET } = await import('@/app/api/organizations/stores/options/route');

    await GET(request('?organizationId=org-1'), {});

    expect(getStoreOptionsForSessionMock).toHaveBeenCalledWith(
      { user: { id: 'u1' } },
      { organizationId: 'org-1' },
    );
  });

  it('refuses an anonymous caller', async () => {
    requireAuthMock.mockRejectedValue(
      Object.assign(new Error('Unauthorized.'), { status: 401, code: 'UNAUTHORIZED' }),
    );
    const { GET } = await import('@/app/api/organizations/stores/options/route');

    const res = await GET(request(), {});

    expect(res.status).toBe(401);
    expect(getStoreOptionsForSessionMock).not.toHaveBeenCalled();
  });
});
