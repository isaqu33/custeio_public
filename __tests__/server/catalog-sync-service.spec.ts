/**
 * @jest-environment node
 */
export {};

// pos.catalog.sync: ONE Alloy request per run, reserved against the store's
// 2/minute quota BEFORE it is made, and an upsert that must never touch what a
// person wrote (recipes).
const connectDBMock = jest.fn();
const appendJobLogMock = jest.fn();
const reserveMock = jest.fn();
const fetchCatalogMock = jest.fn();
const decryptMock = jest.fn();

const storeFindSelectMock = jest.fn();
const storeFindLeanMock = jest.fn();
const storeUpdateOneMock = jest.fn();

const productFindSelectMock = jest.fn();
const productFindLeanMock = jest.fn();
const bulkWriteMock = jest.fn();
const updateManyMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/jobs/log', () => ({ appendJobLog: appendJobLogMock }));
jest.mock('@/app/lib/alloy-rate-limit', () => ({ reserveAlloyRequest: reserveMock }));
jest.mock('@/app/lib/alloy-client', () => ({ fetchAlloyCatalog: fetchCatalogMock }));
jest.mock('@/app/lib/secret-encryption', () => ({ decryptSecret: decryptMock }));
jest.mock('@/app/lib/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: storeFindSelectMock }),
    updateOne: storeUpdateOneMock,
  },
}));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: {
    find: () => ({ select: productFindSelectMock }),
    bulkWrite: bulkWriteMock,
    updateMany: updateManyMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const CTX = { jobId: 'job-1' };

function product(externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    externalId,
    name: `Produto ${externalId}`,
    categoryName: 'Hambúrguer',
    price: 30,
    isActive: true,
    modifiers: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  reserveMock.mockResolvedValue(true);
  decryptMock.mockReturnValue('store-token');
  storeFindSelectMock.mockReturnValue({ lean: storeFindLeanMock });
  storeFindLeanMock.mockResolvedValue({ name: 'Loja', provider: 'alloy', apiKey: 'enc' });
  storeUpdateOneMock.mockResolvedValue({});
  productFindSelectMock.mockReturnValue({ lean: productFindLeanMock });
  productFindLeanMock.mockResolvedValue([]);
  bulkWriteMock.mockResolvedValue({});
  updateManyMock.mockResolvedValue({ modifiedCount: 0 });
  fetchCatalogMock.mockResolvedValue({
    kind: 'ok',
    products: [product('1'), product('2')],
    rateLimitLimit: 2,
    rateLimitRemaining: 1,
  });
});

describe('syncCatalogForStore — the request budget', () => {
  it('reserves the request before calling Alloy, exactly once', async () => {
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    expect(reserveMock).toHaveBeenCalledWith(STORE_ID);
    expect(fetchCatalogMock).toHaveBeenCalledTimes(1);
    expect(reserveMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchCatalogMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not call Alloy when the store quota is spent, and fails as retryable', async () => {
    reserveMock.mockResolvedValue(false);
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    const failure = await syncCatalogForStore(STORE_ID, CTX).catch((err: unknown) => err);

    expect(fetchCatalogMock).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentJobError);
    expect(bulkWriteMock).not.toHaveBeenCalled();
  });

  it('treats a 429 from Alloy as retryable and leaves the store status alone', async () => {
    fetchCatalogMock.mockResolvedValue({ kind: 'rate_limited', rateLimitRemaining: 0 });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    const failure = await syncCatalogForStore(STORE_ID, CTX).catch((err: unknown) => err);

    expect(failure).not.toBeInstanceOf(PermanentJobError);
    const stored = storeUpdateOneMock.mock.calls.map((call) => call[1].$set);
    expect(stored.some((set) => 'status' in set)).toBe(false);
    expect(bulkWriteMock).not.toHaveBeenCalled();
  });
});

describe('syncCatalogForStore — failures a retry cannot fix', () => {
  it('fails permanently and flags the store when Alloy rejects the token', async () => {
    fetchCatalogMock.mockResolvedValue({
      kind: 'rejected',
      message: 'Token da loja informado é inválido.',
    });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    const failure = await syncCatalogForStore(STORE_ID, CTX).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(PermanentJobError);
    expect(storeUpdateOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: { status: 'error', lastError: 'Token da loja informado é inválido.' },
      }),
    );
  });

  it.each([
    ['a missing store', null],
    ['a store without Alloy', { name: 'L', provider: 'saipos', apiKey: 'enc' }],
    ['a store without a key', { name: 'L', provider: 'alloy' }],
  ])('fails permanently for %s, before any Alloy call', async (_label, store) => {
    storeFindLeanMock.mockResolvedValue(store);
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    await expect(syncCatalogForStore(STORE_ID, CTX)).rejects.toBeInstanceOf(PermanentJobError);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(fetchCatalogMock).not.toHaveBeenCalled();
  });

  it('fails permanently when the stored key cannot be decrypted', async () => {
    decryptMock.mockImplementation(() => {
      throw new Error('bad tag');
    });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    await expect(syncCatalogForStore(STORE_ID, CTX)).rejects.toBeInstanceOf(PermanentJobError);
    expect(fetchCatalogMock).not.toHaveBeenCalled();
  });

  it('lets a transient Alloy error retry', async () => {
    fetchCatalogMock.mockResolvedValue({ kind: 'error', message: 'socket hang up' });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');

    const failure = await syncCatalogForStore(STORE_ID, CTX).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentJobError);
  });
});

describe('syncCatalogForStore — the upsert', () => {
  const operations = () => bulkWriteMock.mock.calls.flatMap((call) => call[0]);

  it('upserts by store + Alloy item id and never sets the recipe of a known product', async () => {
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    const [first] = operations();
    expect(first.updateOne.upsert).toBe(true);
    expect(first.updateOne.filter).toMatchObject({ externalId: '1' });
    // Alloy owns these; a person owns `recipe`, which may only be created empty.
    expect(first.updateOne.update.$set).toMatchObject({ name: 'Produto 1', sellingPrice: 30 });
    expect(first.updateOne.update.$set).not.toHaveProperty('recipe');
    expect(first.updateOne.update.$setOnInsert).toEqual({ recipe: [] });
  });

  it('hands each complement its previous recipe back by external id', async () => {
    const recipe = [{ rawIngredientId: 'ing-1', quantity: 20 }];
    productFindLeanMock.mockResolvedValue([
      {
        externalId: '1',
        modifiers: [
          { externalId: 'm-bacon', recipe },
          { externalId: 'm-old', recipe },
        ],
      },
    ]);
    fetchCatalogMock.mockResolvedValue({
      kind: 'ok',
      products: [
        product('1', {
          modifiers: [
            { externalId: 'm-bacon', name: 'Bacon', group: 'Extras', price: 6, isActive: true },
            { externalId: 'm-new', name: 'Ovo', group: 'Extras', price: 3, isActive: true },
          ],
        }),
      ],
    });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    const modifiers = operations()[0].updateOne.update.$set.modifiers;
    expect(modifiers).toEqual([
      expect.objectContaining({ externalId: 'm-bacon', recipe }),
      expect.objectContaining({ externalId: 'm-new', recipe: [] }),
    ]);
  });

  it('clears the promotional price and code Alloy no longer sends', async () => {
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    expect(operations()[0].updateOne.update.$unset).toEqual({ promotionalPrice: '', codPdv: '' });
  });

  it('counts created vs updated and reports what it deactivated', async () => {
    productFindLeanMock.mockResolvedValue([{ externalId: '1', modifiers: [] }]);
    updateManyMock.mockResolvedValue({ modifiedCount: 3 });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    const summary = await syncCatalogForStore(STORE_ID, CTX);

    expect(summary).toMatchObject({ products: 2, created: 1, updated: 1, deactivated: 3 });
    const filter = updateManyMock.mock.calls[0][0];
    expect(String(filter.storeId)).toBe(STORE_ID);
    expect(filter.isActive).toBe(true);
    expect(updateManyMock.mock.calls[0][1]).toEqual({ $set: { isActive: false } });
  });

  it('never switches the menu off when Alloy answers with an empty catalog', async () => {
    fetchCatalogMock.mockResolvedValue({ kind: 'ok', products: [] });
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    const summary = await syncCatalogForStore(STORE_ID, CTX);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ products: 0, deactivated: 0 });
  });

  it('marks the store connected and records the rate-limit numbers on success', async () => {
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    expect(storeUpdateOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'connected',
          alloyRateLimitLimit: 2,
          alloyRateLimitRemaining: 1,
        }),
        $unset: { lastError: '' },
      }),
    );
  });

  it('writes the steps of the run to the job log, in Portuguese', async () => {
    const { syncCatalogForStore } = await import('@/app/lib/services/catalog-sync');

    await syncCatalogForStore(STORE_ID, CTX);

    const steps = appendJobLogMock.mock.calls.map((call) => call[1].step);
    expect(steps).toEqual(['sync-start', 'alloy-fetch', 'sync-done']);
    expect(appendJobLogMock.mock.calls.at(-1)?.[1].message).toContain('Sincronização concluída');
  });
});
