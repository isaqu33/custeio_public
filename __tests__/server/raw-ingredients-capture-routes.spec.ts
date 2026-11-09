/**
 * @jest-environment node
 */
export {};

// The manual-upload NFe capture routes — enqueue + poll status. What matters
// here: both resolve storeId -> organization before trusting anything, same
// as every other raw-ingredients route, and the enqueue route hands the
// upload straight to the job payload without re-parsing it.
const requireAuthMock = jest.fn();
const requireSessionUserMock = jest.fn();
const parseRouteInputMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const getStoreOrganizationIdMock = jest.fn();
const createAndEnqueueJobMock = jest.fn();

const jobsFindOneMock = jest.fn();

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
      this.name = 'NotFoundError';
    }
  }
  return { HttpError, NotFoundError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/authorization', () => ({
  requireOrganizationAccess: requireOrganizationAccessMock,
  requireSessionUser: requireSessionUserMock,
}));
jest.mock('@/app/lib/services/stores', () => ({
  getStoreOrganizationId: getStoreOrganizationIdMock,
}));
jest.mock('@/app/lib/services/nfe-sync-claim', () => ({
  getSefazSyncAvailability: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/app/lib/jobs/service', () => ({
  createAndEnqueueJob: createAndEnqueueJobMock,
}));
jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: { findOne: jobsFindOneMock },
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

const STORE_ID = '665f735a90788d97f5a76322';
const ORG_ID = '665f735a90788d97f5a76399';

function request(url: string, method: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  requireSessionUserMock.mockReturnValue({ user: { id: 'u1' } });
  requireOrganizationAccessMock.mockResolvedValue(undefined);
  getStoreOrganizationIdMock.mockResolvedValue(ORG_ID);
});

describe('POST /api/raw-ingredients/capture', () => {
  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({
      storeId: STORE_ID,
      files: [{ fileName: 'nota.xml', content: '<nfeProc></nfeProc>' }],
    });
    createAndEnqueueJobMock.mockResolvedValue({ dbJobId: 'job-1', queueJobId: 'bull-1' });
  });

  it('enqueues sefaz.nfe.received once the store is authorized', async () => {
    const { POST } = await import('@/app/api/raw-ingredients/capture/route');

    const res = await POST(request('/api/raw-ingredients/capture', 'POST', {}), {});

    expect(res.status).toBe(201);
    expect(getStoreOrganizationIdMock).toHaveBeenCalledWith(STORE_ID);
    expect(requireOrganizationAccessMock).toHaveBeenCalledWith({ user: { id: 'u1' } }, ORG_ID);
    expect(createAndEnqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sefaz.nfe.received',
        organizationId: ORG_ID,
        payload: expect.objectContaining({ storeId: STORE_ID, requestedByUserId: 'u1' }),
      }),
    );
  });

  it('never enqueues against a store that does not exist', async () => {
    getStoreOrganizationIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/raw-ingredients/capture/route');

    const res = await POST(request('/api/raw-ingredients/capture', 'POST', {}), {});

    expect(res.status).toBe(404);
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });

  it('refuses a store the session is not authorized for', async () => {
    requireOrganizationAccessMock.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
    );
    const { POST } = await import('@/app/api/raw-ingredients/capture/route');

    const res = await POST(request('/api/raw-ingredients/capture', 'POST', {}), {});

    expect(res.status).toBe(403);
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/raw-ingredients/capture/status', () => {
  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
  });

  it('reports in progress when a queued/running job exists for the store', async () => {
    jobsFindOneMock.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ _id: 'job-1' }) }),
    });
    const { GET } = await import('@/app/api/raw-ingredients/capture/status/route');

    const res = await GET(
      request(`/api/raw-ingredients/capture/status?storeId=${STORE_ID}`, 'GET'),
      {},
    );
    const body = (await res.json()) as { data: { inProgress: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.inProgress).toBe(true);
    expect(jobsFindOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sefaz.nfe.received',
        'payload.storeId': STORE_ID,
        status: { $in: ['queued', 'running'] },
      }),
    );
  });

  it('reports the last completed run once nothing is in progress', async () => {
    jobsFindOneMock
      .mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) })
      .mockReturnValueOnce({
        select: () => ({
          sort: () => ({
            lean: () =>
              Promise.resolve({
                status: 'done',
                result: {
                  totalFiles: 2,
                  filesProcessed: 2,
                  totalItemsMatched: 1,
                  totalItemsDrafted: 1,
                },
              }),
          }),
        }),
      });
    const { GET } = await import('@/app/api/raw-ingredients/capture/status/route');

    const res = await GET(
      request(`/api/raw-ingredients/capture/status?storeId=${STORE_ID}`, 'GET'),
      {},
    );
    const body = (await res.json()) as {
      data: { inProgress: boolean; lastCompleted?: { status: string; totalItemsDrafted?: number } };
    };

    expect(body.data.inProgress).toBe(false);
    expect(body.data.lastCompleted).toMatchObject({ status: 'done', totalItemsDrafted: 1 });
  });

  it('refuses a store the session is not authorized for', async () => {
    requireOrganizationAccessMock.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
    );
    const { GET } = await import('@/app/api/raw-ingredients/capture/status/route');

    const res = await GET(
      request(`/api/raw-ingredients/capture/status?storeId=${STORE_ID}`, 'GET'),
      {},
    );

    expect(res.status).toBe(403);
    expect(jobsFindOneMock).not.toHaveBeenCalled();
  });
});
