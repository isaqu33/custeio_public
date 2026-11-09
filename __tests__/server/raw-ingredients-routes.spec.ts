/**
 * @jest-environment node
 */
export {};

// The Estoque page's routes. What matters here: `RawIngredients` only ever
// carries a `storeId`, so every route must resolve the owning organization
// before trusting the caller-supplied id for anything (list/create resolve
// from `storeId`, update resolves from the ingredient's own id first).
const requireAuthMock = jest.fn();
const parseRouteInputMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const getStoreOrganizationIdMock = jest.fn();
const getRawIngredientsForStoreMock = jest.fn();
const createRawIngredientForStoreMock = jest.fn();
const getRawIngredientStoreIdMock = jest.fn();
const updateRawIngredientMock = jest.fn();
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
      this.name = 'NotFoundError';
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
  getRawIngredientsForStore: getRawIngredientsForStoreMock,
  createRawIngredientForStore: createRawIngredientForStoreMock,
  getRawIngredientStoreId: getRawIngredientStoreIdMock,
  updateRawIngredient: updateRawIngredientMock,
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
const INGREDIENT_ID = '665f735a90788d97f5a76abc';

function request(url: string, method: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  requireOrganizationAccessMock.mockResolvedValue(undefined);
  getStoreOrganizationIdMock.mockResolvedValue(ORG_ID);
  getRawIngredientStoreIdMock.mockResolvedValue(STORE_ID);
});

describe('GET /api/raw-ingredients', () => {
  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
    getRawIngredientsForStoreMock.mockResolvedValue([{ _id: 'ing-1', name: 'Queijo' }]);
  });

  it('resolves the store’s organization before listing', async () => {
    const { GET } = await import('@/app/api/raw-ingredients/route');

    const res = await GET(request('/api/raw-ingredients?storeId=' + STORE_ID, 'GET'), {});
    const body = (await res.json()) as { data: unknown[] };

    expect(res.status).toBe(200);
    expect(getStoreOrganizationIdMock).toHaveBeenCalledWith(STORE_ID);
    expect(requireOrganizationAccessMock).toHaveBeenCalledWith({ user: { id: 'u1' } }, ORG_ID);
    expect(body.data).toHaveLength(1);
  });

  it('answers 404 for a store that does not exist, without listing anything', async () => {
    getStoreOrganizationIdMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/raw-ingredients/route');

    const res = await GET(request('/api/raw-ingredients?storeId=' + STORE_ID, 'GET'), {});

    expect(res.status).toBe(404);
    expect(getRawIngredientsForStoreMock).not.toHaveBeenCalled();
  });

  it('refuses a store the session is not authorized for', async () => {
    requireOrganizationAccessMock.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
    );
    const { GET } = await import('@/app/api/raw-ingredients/route');

    const res = await GET(request('/api/raw-ingredients?storeId=' + STORE_ID, 'GET'), {});

    expect(res.status).toBe(403);
    expect(getRawIngredientsForStoreMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/raw-ingredients/create', () => {
  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({
      storeId: STORE_ID,
      name: 'Queijo mussarela',
      unit: 'g',
      currentStock: 0,
      averageCost: 0,
      minAlertStock: 0,
    });
    createRawIngredientForStoreMock.mockResolvedValue({
      _id: INGREDIENT_ID,
      name: 'Queijo mussarela',
    });
  });

  it('creates the ingredient once the store is authorized, and audits it', async () => {
    const { POST } = await import('@/app/api/raw-ingredients/create/route');

    const res = await POST(request('/api/raw-ingredients/create', 'POST', {}), {});

    expect(res.status).toBe(200);
    expect(createRawIngredientForStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: STORE_ID, name: 'Queijo mussarela' }),
    );
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        action: 'raw_ingredients.create',
        resourceType: 'raw_ingredient',
      }),
    );
  });

  it('never creates against a store that does not exist', async () => {
    getStoreOrganizationIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/raw-ingredients/create/route');

    const res = await POST(request('/api/raw-ingredients/create', 'POST', {}), {});

    expect(res.status).toBe(404);
    expect(createRawIngredientForStoreMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/raw-ingredients/update', () => {
  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ id: INGREDIENT_ID, currentStock: 500 });
    updateRawIngredientMock.mockResolvedValue({ _id: INGREDIENT_ID, name: 'Queijo mussarela' });
  });

  it('resolves the ingredient’s store, then that store’s organization, before updating', async () => {
    const { POST } = await import('@/app/api/raw-ingredients/update/route');

    const res = await POST(request('/api/raw-ingredients/update', 'POST', {}), {});

    expect(res.status).toBe(200);
    expect(getRawIngredientStoreIdMock).toHaveBeenCalledWith(INGREDIENT_ID);
    expect(getStoreOrganizationIdMock).toHaveBeenCalledWith(STORE_ID);
    expect(requireOrganizationAccessMock).toHaveBeenCalledWith({ user: { id: 'u1' } }, ORG_ID);
    expect(updateRawIngredientMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: INGREDIENT_ID, currentStock: 500 }),
    );
  });

  it('answers 404 for an ingredient that does not exist', async () => {
    getRawIngredientStoreIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/raw-ingredients/update/route');

    const res = await POST(request('/api/raw-ingredients/update', 'POST', {}), {});

    expect(res.status).toBe(404);
    expect(updateRawIngredientMock).not.toHaveBeenCalled();
  });
});
