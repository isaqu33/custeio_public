/**
 * @jest-environment node
 */
export {};

// "Buscar na SEFAZ" enqueue route: one run per store, gated by the claim
// (cooldown / block / hourly ceiling), and the job carries no files — it
// fetches the documents itself.
const requireAuthMock = jest.fn();
const requireSessionUserMock = jest.fn();
const parseRouteInputMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const getStoreOrganizationIdMock = jest.fn();
const createAndEnqueueJobMock = jest.fn();
const claimMock = jest.fn();
const jobsExistsMock = jest.fn();

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
  class ConflictError extends HttpError {
    constructor(message = 'Conflict.') {
      super(409, 'CONFLICT', message);
    }
  }
  return { HttpError, NotFoundError, ConflictError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/authorization', () => ({
  requireOrganizationAccess: requireOrganizationAccessMock,
  requireSessionUser: requireSessionUserMock,
}));
jest.mock('@/app/lib/services/stores', () => ({
  getStoreOrganizationId: getStoreOrganizationIdMock,
}));
jest.mock('@/app/lib/services/nfe-sync-claim', () => ({ claimSefazSync: claimMock }));
jest.mock('@/app/lib/jobs/service', () => ({ createAndEnqueueJob: createAndEnqueueJobMock }));
jest.mock('@/app/models/jobs', () => ({ __esModule: true, default: { exists: jobsExistsMock } }));
jest.mock('@/app/lib/observability', () => ({
  withObservability:
    (
      _name: string,
      handler: (_req: Request, _ctx: unknown, _obs: { log: unknown }) => Promise<Response>,
    ) =>
    async (req: Request, ctx: unknown) => {
      try {
        return await handler(req, ctx, { log: {} });
      } catch (err) {
        const e = err as { status?: number; code?: string; message: string };
        return Response.json(
          { done: false, error: e.code, message: e.message },
          { status: e.status ?? 500 },
        );
      }
    },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ORG_ID = '665f735a90788d97f5a76300';

function post() {
  return new Request('http://localhost/api/raw-ingredients/capture/sync', {
    method: 'POST',
    body: JSON.stringify({ storeId: STORE_ID }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  requireSessionUserMock.mockReturnValue({ user: { id: 'u1' } });
  parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
  getStoreOrganizationIdMock.mockResolvedValue(ORG_ID);
  requireOrganizationAccessMock.mockResolvedValue(undefined);
  jobsExistsMock.mockResolvedValue(null);
  claimMock.mockResolvedValue(undefined);
  createAndEnqueueJobMock.mockResolvedValue({ dbJobId: 'j1', queueJobId: 'q1' });
});

describe('POST /api/raw-ingredients/capture/sync', () => {
  it('claims the search, then enqueues a filesless sefaz-mode job', async () => {
    const { POST } = await import('@/app/api/raw-ingredients/capture/sync/route');
    const res = await POST(post(), {});

    expect(res.status).toBe(201);
    expect(claimMock).toHaveBeenCalledWith(STORE_ID);
    expect(createAndEnqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sefaz.nfe.received',
        organizationId: ORG_ID,
        payload: { requestedByUserId: 'u1', storeId: STORE_ID, mode: 'sefaz' },
      }),
    );
  });

  it('refuses a second run while one is queued or running, without spending the claim', async () => {
    jobsExistsMock.mockResolvedValue({ _id: 'running' });
    const { POST } = await import('@/app/api/raw-ingredients/capture/sync/route');
    const res = await POST(post(), {});

    expect(res.status).toBe(409);
    expect(claimMock).not.toHaveBeenCalled();
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });

  it('passes the 429 through and enqueues nothing when the claim is refused', async () => {
    claimMock.mockRejectedValue(
      Object.assign(new Error('A SEFAZ search for this store ran recently. Try again in 40 min.'), {
        status: 429,
        code: 'TOO_MANY_REQUESTS',
      }),
    );
    const { POST } = await import('@/app/api/raw-ingredients/capture/sync/route');
    const res = await POST(post(), {});

    expect(res.status).toBe(429);
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });

  it('refuses a store the session cannot access before touching the quota', async () => {
    requireOrganizationAccessMock.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
    );
    const { POST } = await import('@/app/api/raw-ingredients/capture/sync/route');
    const res = await POST(post(), {});

    expect(res.status).toBe(403);
    expect(claimMock).not.toHaveBeenCalled();
  });
});
