/**
 * @jest-environment node
 */
export {};

const authMock = jest.fn();
const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();
// The jobs listing hides the platform CSV reports from a non-system session.
const sessionHasSystemAccessMock = jest.fn().mockResolvedValue(false);
const requireSystemAccessMock = jest.fn();
const countDocumentsMock = jest.fn();
const leanMock = jest.fn();
const limitMock = jest.fn(() => ({ lean: leanMock }));
const skipMock = jest.fn(() => ({ limit: limitMock }));
const sortMock = jest.fn(() => ({ skip: skipMock }));
const selectMock = jest.fn(() => ({ sort: sortMock }));
const findMock = jest.fn(() => ({ select: selectMock }));

jest.mock('@/app/lib/auth', () => ({
  auth: authMock,
}));

jest.mock('@/app/lib/connect-db', () => ({
  __esModule: true,
  default: connectDBMock,
}));

jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
  requireSystemAccess: requireSystemAccessMock,
  sessionHasSystemAccess: sessionHasSystemAccessMock,
}));

jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: {
    find: findMock,
    countDocuments: countDocumentsMock,
  },
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
        const e = err as { status?: number; code?: string };
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

describe('POST /api/jobs/list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({
      user: { id: 'u1' },
    });
    getAuthorizedOrganizationIdsMock.mockResolvedValue(['org-1']);
    connectDBMock.mockResolvedValue(undefined);
    countDocumentsMock.mockResolvedValue(1);
    leanMock.mockResolvedValue([
      {
        _id: 'job-1',
        organizationId: 'org-1',
        reference: 'JOB-1',
        type: 'Gateway',
        status: 'done',
        createdAt: new Date().toISOString(),
      },
    ]);
  });

  it('applies kind and date range filters', async () => {
    // Filtering by a platform report only reaches the query for a System
    // session; a tenant asking for the same kind matches nothing, which
    // `services.spec.ts` covers.
    sessionHasSystemAccessMock.mockResolvedValueOnce(true);
    const { POST } = await import('@/app/api/jobs/list/route');
    const req = new Request('http://localhost/api/jobs/list', {
      method: 'POST',
      body: JSON.stringify({
        page: 1,
        limit: 20,
        kind: 'users.export.csv',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-28',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    expect(findMock).toHaveBeenCalledTimes(1);

    const firstCall = (findMock.mock.calls as unknown as Array<[Record<string, unknown>]>)[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('expected find call');
    const query = firstCall[0];
    expect(query.$and).toEqual([
      { $or: [{ organizationId: { $in: ['org-1'] } }, { organizationId: { $exists: false } }] },
    ]);
    expect(query.kind).toBe('users.export.csv');
    expect(query.createdAt).toBeDefined();
  });

  it('returns unauthorized when session is missing', async () => {
    authMock.mockResolvedValueOnce(null);
    const { POST } = await import('@/app/api/jobs/list/route');
    const req = new Request('http://localhost/api/jobs/list', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, {});
    expect(res.status).toBe(401);
  });
});
