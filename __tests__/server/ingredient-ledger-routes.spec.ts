/**
 * @jest-environment node
 */
export {};

// The two routes of the ingredient ledger: the history behind a balance and the
// inventory count. Tenant-facing: the ingredient's id is resolved to its store
// and organization before it is trusted.
const requireAuthMock = jest.fn();
const parseRouteInputMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const getStoreOrganizationIdMock = jest.fn();
const getRawIngredientStoreIdMock = jest.fn();
const countRawIngredientStockMock = jest.fn();
const listMovementsMock = jest.fn();
const logAuditEventMock = jest.fn();

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
  return { HttpError, NotFoundError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/authorization', () => ({
  requireOrganizationAccess: requireOrganizationAccessMock,
}));
jest.mock('@/app/lib/services/stores', () => ({
  getStoreOrganizationId: getStoreOrganizationIdMock,
}));
jest.mock('@/app/lib/services/raw-ingredients', () => ({
  getRawIngredientStoreId: getRawIngredientStoreIdMock,
  countRawIngredientStock: countRawIngredientStockMock,
}));
jest.mock('@/app/lib/services/stock-movements', () => ({
  listMovementsForIngredient: listMovementsMock,
}));
jest.mock('@/app/lib/services/audit-events', () => ({ logAuditEvent: logAuditEventMock }));
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
const ING_ID = '665f735a90788d97f5a76a01';

const forbidden = () => Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' });

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  getRawIngredientStoreIdMock.mockResolvedValue(STORE_ID);
  getStoreOrganizationIdMock.mockResolvedValue(ORG_ID);
  requireOrganizationAccessMock.mockResolvedValue(undefined);
});

describe('GET /api/raw-ingredients/movements', () => {
  const get = () =>
    new Request(`http://localhost/api/raw-ingredients/movements?ingredientId=${ING_ID}`);

  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ ingredientId: ING_ID });
    listMovementsMock.mockResolvedValue([{ _id: 'm1', type: 'purchase' }]);
  });

  it('resolves ingredient → store → organization, then returns the history', async () => {
    const { GET } = await import('@/app/api/raw-ingredients/movements/route');

    const res = await GET(get(), {});

    expect(res.status).toBe(200);
    expect(getRawIngredientStoreIdMock).toHaveBeenCalledWith(ING_ID);
    expect(getStoreOrganizationIdMock).toHaveBeenCalledWith(STORE_ID);
    expect(requireOrganizationAccessMock).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect((await res.json()).data).toEqual([{ _id: 'm1', type: 'purchase' }]);
  });

  it('shows nothing of an organization the session cannot access', async () => {
    requireOrganizationAccessMock.mockRejectedValue(forbidden());
    const { GET } = await import('@/app/api/raw-ingredients/movements/route');

    expect((await GET(get(), {})).status).toBe(403);
    expect(listMovementsMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown ingredient', async () => {
    getRawIngredientStoreIdMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/raw-ingredients/movements/route');

    expect((await GET(get(), {})).status).toBe(404);
    expect(listMovementsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/raw-ingredients/count', () => {
  const post = () =>
    new Request('http://localhost/api/raw-ingredients/count', {
      method: 'POST',
      body: JSON.stringify({ id: ING_ID, countedStock: 1200 }),
    });

  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ id: ING_ID, countedStock: 1200, note: 'set' });
    countRawIngredientStockMock.mockResolvedValue({ _id: ING_ID, name: 'Açúcar' });
  });

  it('records the count for the signed-in user and audits it', async () => {
    const { POST } = await import('@/app/api/raw-ingredients/count/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(200);
    expect(countRawIngredientStockMock).toHaveBeenCalledWith({
      id: ING_ID,
      countedStock: 1200,
      note: 'set',
      userId: 'u1',
    });
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        action: 'raw_ingredients.count_stock',
        metadata: expect.objectContaining({ countedStock: 1200 }),
      }),
    );
  });

  it('never writes for an ingredient of an organization the session cannot access', async () => {
    requireOrganizationAccessMock.mockRejectedValue(forbidden());
    const { POST } = await import('@/app/api/raw-ingredients/count/route');

    expect((await POST(post(), {})).status).toBe(403);
    expect(countRawIngredientStockMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown ingredient', async () => {
    getRawIngredientStoreIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/raw-ingredients/count/route');

    expect((await POST(post(), {})).status).toBe(404);
    expect(countRawIngredientStockMock).not.toHaveBeenCalled();
  });
});
