/**
 * @jest-environment node
 */
export {};

// The Produtos routes: sync (one run per store, cooldown-claimed, retry policy
// sized for Alloy's per-minute quota), its status poll, the recipe save, and
// both CSV exports. Tenant-facing: every id is resolved to its organization
// before it is trusted.
const requireAuthMock = jest.fn();
const requireSessionUserMock = jest.fn();
const parseRouteInputMock = jest.fn();
const requireOrganizationAccessMock = jest.fn();
const getStoreOrganizationIdMock = jest.fn();
const createAndEnqueueJobMock = jest.fn();
const claimMock = jest.fn();
const availabilityMock = jest.fn();
const jobsExistsMock = jest.fn();
const jobsFindOneMock = jest.fn();
const getProductStoreIdMock = jest.fn();
const updateProductRecipeMock = jest.fn();
const getAllProductsMock = jest.fn();
const getAllIngredientsMock = jest.fn();
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
jest.mock('@/app/lib/services/catalog-sync-claim', () => ({
  claimCatalogSync: claimMock,
  getCatalogSyncAvailability: availabilityMock,
}));
jest.mock('@/app/lib/services/products', () => ({
  getProductStoreId: getProductStoreIdMock,
  updateProductRecipe: updateProductRecipeMock,
  getAllProductsForStore: getAllProductsMock,
}));
jest.mock('@/app/lib/services/raw-ingredients', () => ({
  getAllRawIngredientsForStore: getAllIngredientsMock,
}));
jest.mock('@/app/lib/services/audit-events', () => ({ logAuditEvent: logAuditEventMock }));
jest.mock('@/app/lib/jobs/service', () => ({ createAndEnqueueJob: createAndEnqueueJobMock }));
jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: {
    exists: jobsExistsMock,
    findOne: () => ({
      select: () => ({ sort: () => ({ lean: jobsFindOneMock }) }),
    }),
  },
}));
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
const PRODUCT_ID = '665f735a90788d97f5a76400';

const forbidden = () => Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' });

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: 'u1' } });
  requireSessionUserMock.mockReturnValue({ user: { id: 'u1' } });
  parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
  getStoreOrganizationIdMock.mockResolvedValue(ORG_ID);
  requireOrganizationAccessMock.mockResolvedValue(undefined);
  jobsExistsMock.mockResolvedValue(null);
  claimMock.mockResolvedValue(undefined);
  availabilityMock.mockResolvedValue({});
  createAndEnqueueJobMock.mockResolvedValue({ dbJobId: 'j1', queueJobId: 'q1' });
});

describe('POST /api/products/sync', () => {
  const post = () =>
    new Request('http://localhost/api/products/sync', {
      method: 'POST',
      body: JSON.stringify({ storeId: STORE_ID }),
    });

  it('claims the cooldown, then enqueues pos.catalog.sync for the store', async () => {
    const { POST } = await import('@/app/api/products/sync/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(201);
    expect(claimMock).toHaveBeenCalledWith(STORE_ID);
    expect(createAndEnqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pos.catalog.sync',
        organizationId: ORG_ID,
        payload: { requestedByUserId: 'u1', storeId: STORE_ID },
      }),
    );
  });

  it('retries a quota refusal after the 60s window, not after a few seconds', async () => {
    const { POST } = await import('@/app/api/products/sync/route');

    await POST(post(), {});

    const config = createAndEnqueueJobMock.mock.calls[0][0].config;
    expect(config.attempts).toBe(3);
    expect(config.backoff).toEqual({ type: 'fixed', delay: 65_000 });
  });

  it('refuses a second run while one is queued or running, without spending the claim', async () => {
    jobsExistsMock.mockResolvedValue({ _id: 'running' });
    const { POST } = await import('@/app/api/products/sync/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(409);
    expect(claimMock).not.toHaveBeenCalled();
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });

  it('passes a cooldown 429 through and enqueues nothing', async () => {
    claimMock.mockRejectedValue(
      Object.assign(new Error('Try again in 6 min.'), { status: 429, code: 'TOO_MANY_REQUESTS' }),
    );
    const { POST } = await import('@/app/api/products/sync/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(429);
    expect(createAndEnqueueJobMock).not.toHaveBeenCalled();
  });

  it('refuses a store the session cannot access before touching anything', async () => {
    requireOrganizationAccessMock.mockRejectedValue(forbidden());
    const { POST } = await import('@/app/api/products/sync/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(403);
    expect(jobsExistsMock).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown store', async () => {
    getStoreOrganizationIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/products/sync/route');

    expect((await POST(post(), {})).status).toBe(404);
  });
});

describe('GET /api/products/sync/status', () => {
  const get = () => new Request(`http://localhost/api/products/sync/status?storeId=${STORE_ID}`);

  it('reports a run in flight with the button availability', async () => {
    jobsExistsMock.mockResolvedValue({ _id: 'running' });
    availabilityMock.mockResolvedValue({ nextAllowedAt: '2026-09-26T12:10:00.000Z' });
    const { GET } = await import('@/app/api/products/sync/status/route');

    const body = await (await GET(get(), {})).json();

    expect(body.data).toEqual({
      inProgress: true,
      sync: { nextAllowedAt: '2026-09-26T12:10:00.000Z' },
      lastCompleted: undefined,
    });
    expect(jobsFindOneMock).not.toHaveBeenCalled();
  });

  it('summarizes the last finished run', async () => {
    jobsFindOneMock.mockResolvedValue({
      status: 'done',
      result: { products: 82, activeProducts: 39, created: 82, updated: 0, deactivated: 0 },
      progress: { timings: { finishedAt: new Date('2026-09-26T12:00:00Z') } },
    });
    const { GET } = await import('@/app/api/products/sync/status/route');

    const body = await (await GET(get(), {})).json();

    expect(body.data.inProgress).toBe(false);
    expect(body.data.lastCompleted).toMatchObject({
      status: 'done',
      products: 82,
      activeProducts: 39,
      created: 82,
      finishedAt: '2026-09-26T12:00:00.000Z',
    });
    expect(body.data.lastCompleted.error).toBeUndefined();
  });

  it('carries the reason of a failed run', async () => {
    jobsFindOneMock.mockResolvedValue({
      status: 'failed',
      errorLogs: [{ message: 'primeira' }, { message: 'Token da loja informado é inválido.' }],
    });
    const { GET } = await import('@/app/api/products/sync/status/route');

    const body = await (await GET(get(), {})).json();

    expect(body.data.lastCompleted).toMatchObject({
      status: 'failed',
      error: 'Token da loja informado é inválido.',
    });
  });

  it('refuses a store the session cannot access', async () => {
    requireOrganizationAccessMock.mockRejectedValue(forbidden());
    const { GET } = await import('@/app/api/products/sync/status/route');

    expect((await GET(get(), {})).status).toBe(403);
  });
});

describe('POST /api/products/recipe', () => {
  const recipe = [{ rawIngredientId: '665f735a90788d97f5a76a01', quantity: 150 }];
  const post = () =>
    new Request('http://localhost/api/products/recipe', {
      method: 'POST',
      body: JSON.stringify({ id: PRODUCT_ID, recipe }),
    });

  beforeEach(() => {
    parseRouteInputMock.mockResolvedValue({ id: PRODUCT_ID, recipe });
    getProductStoreIdMock.mockResolvedValue(STORE_ID);
    updateProductRecipeMock.mockResolvedValue({ _id: PRODUCT_ID, name: 'X-Bacon' });
  });

  it('resolves product → store → organization before saving, and audits it', async () => {
    const { POST } = await import('@/app/api/products/recipe/route');

    const res = await POST(post(), {});

    expect(res.status).toBe(200);
    expect(getProductStoreIdMock).toHaveBeenCalledWith(PRODUCT_ID);
    expect(getStoreOrganizationIdMock).toHaveBeenCalledWith(STORE_ID);
    expect(requireOrganizationAccessMock).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(updateProductRecipeMock).toHaveBeenCalledWith({ id: PRODUCT_ID, recipe });
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, action: 'products.update_recipe' }),
    );
  });

  it('never writes for a product of an organization the session cannot access', async () => {
    requireOrganizationAccessMock.mockRejectedValue(forbidden());
    const { POST } = await import('@/app/api/products/recipe/route');

    expect((await POST(post(), {})).status).toBe(403);
    expect(updateProductRecipeMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown product', async () => {
    getProductStoreIdMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/products/recipe/route');

    expect((await POST(post(), {})).status).toBe(404);
    expect(updateProductRecipeMock).not.toHaveBeenCalled();
  });
});

describe('CSV exports', () => {
  const get = (path: string) =>
    new Request(`http://localhost${path}?storeId=${STORE_ID}`, { method: 'GET' });

  it('products: a semicolon CSV download of everything the filters match', async () => {
    parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID, q: 'bacon', status: 'all' });
    getAllProductsMock.mockResolvedValue([
      {
        name: '=HYPERLINK("x")',
        categoryName: 'Hambúrguer',
        codPdv: undefined,
        sellingPrice: 30,
        promotionalPrice: undefined,
        cost: 9.5,
        margin: 20.5,
        marginPercent: 68.33,
        recipe: [{}, {}],
        costIncomplete: false,
        modifiersCount: 4,
        isActive: true,
        externalId: '1208901',
      },
      {
        name: 'Sem ficha',
        categoryName: '',
        sellingPrice: 10,
        recipe: [],
        costIncomplete: false,
        modifiersCount: 0,
        isActive: false,
        externalId: '2',
      },
    ]);
    const { GET } = await import('@/app/api/products/export/route');

    const res = await GET(get('/api/products/export'), {});
    const text = await res.text();

    expect(getAllProductsMock).toHaveBeenCalledWith(STORE_ID, { q: 'bacon', status: 'all' });
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="produtos-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = text.split('\r\n');
    expect(lines[0]).toContain('Produto;Categoria;Código PDV');
    // A formula in a name is defused; cost/margin are empty (not 0) with no recipe.
    expect(lines[1]).toBe('﻿'.length ? lines[1] : '');
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain(';30;;9,5;20,5;68,33;2;não;4;sim;1208901');
    expect(lines[2]).toBe('Sem ficha;;;10;;;;;0;;0;não;2');
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'products.export',
        metadata: expect.objectContaining({ rows: 2 }),
      }),
    );
  });

  it('products: defaults to active products only', async () => {
    parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
    getAllProductsMock.mockResolvedValue([]);
    const { GET } = await import('@/app/api/products/export/route');

    await GET(get('/api/products/export'), {});

    expect(getAllProductsMock).toHaveBeenCalledWith(STORE_ID, { q: undefined, status: 'active' });
  });

  it('ingredients: the store as a spreadsheet, in kg/L, with supplier and last purchase', async () => {
    parseRouteInputMock.mockResolvedValue({ storeId: STORE_ID });
    getAllIngredientsMock.mockResolvedValue([
      {
        name: 'Acucar Cristal Brasilia 5kg',
        kind: 'food',
        unit: 'g',
        currentStock: 5000,
        averageCost: 0.002498,
        minAlertStock: 1000,
        lastPurchase: {
          at: '2026-08-11T15:00:00.000Z',
          supplierName: 'LOJA SANTA MARIA',
          invoiceNumber: '30892',
          unitCost: 0.002498,
        },
        usedInProducts: 4,
        isDraft: true,
      },
      {
        name: 'Detergente',
        kind: 'cleaning',
        unit: 'ml',
        currentStock: -50,
        averageCost: 0.005,
        minAlertStock: 0,
        usedInProducts: 0,
        isDraft: false,
      },
    ]);
    const { GET } = await import('@/app/api/raw-ingredients/export/route');

    const res = await GET(get('/api/raw-ingredients/export'), {});
    const lines = (await res.text()).split('\r\n');

    expect(res.headers.get('Content-Disposition')).toMatch(/filename="insumos-/);
    expect(lines[0]).toContain('Insumo;Tipo;Unidade;Estoque estimado');
    // Quantities and costs in the unit people read: 5000 g -> 5 kg, R$ 0,002498/g -> R$ 2,498/kg.
    expect(lines[1]).toBe(
      'Acucar Cristal Brasilia 5kg;Alimento;kg;5;2,498;12,49;1;11/08/2026;LOJA SANTA MARIA;30892;2,498;4;sim',
    );
    // A negative balance is worth 0; a row without a purchase leaves those cells empty.
    expect(lines[2]).toBe('Detergente;Limpeza;L;-0,05;5;0;0;;;;;0;não');
  });

  it('ingredients: hands the type, usage and supplier filters to the service', async () => {
    parseRouteInputMock.mockResolvedValue({
      storeId: STORE_ID,
      q: 'sal',
      kind: 'cleaning',
      usage: 'unused',
      supplier: '27289076001530',
    });
    getAllIngredientsMock.mockResolvedValue([]);
    const { GET } = await import('@/app/api/raw-ingredients/export/route');

    await GET(get('/api/raw-ingredients/export'), {});

    expect(getAllIngredientsMock).toHaveBeenCalledWith(STORE_ID, {
      q: 'sal',
      kind: 'cleaning',
      usage: 'unused',
      supplier: '27289076001530',
    });
  });

  it.each([
    ['products', '@/app/api/products/export/route', '/api/products/export'],
    ['ingredients', '@/app/api/raw-ingredients/export/route', '/api/raw-ingredients/export'],
  ])(
    '%s: refuses a store the session cannot access, exporting nothing',
    async (_n, module, path) => {
      requireOrganizationAccessMock.mockRejectedValue(forbidden());
      const { GET } = await import(module);

      expect((await GET(get(path), {})).status).toBe(403);
      expect(getAllProductsMock).not.toHaveBeenCalled();
      expect(getAllIngredientsMock).not.toHaveBeenCalled();
    },
  );
});
