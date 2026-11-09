/**
 * @jest-environment node
 */
export {};

// The cooldown on "Sincronizar cardápio": it stops the button being mashed
// (each sync is one of the store's 2 Alloy requests per minute) and is claimed
// with a conditional update so two simultaneous clicks cannot both win.
const envMock = { ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES: 10 };
jest.mock('@/app/lib/env', () => ({
  get env() {
    return envMock;
  },
}));

const connectDBMock = jest.fn();
const findSelectMock = jest.fn();
const findLeanMock = jest.fn();
const claimLeanMock = jest.fn();
const claimMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: findSelectMock }),
    findOneAndUpdate: claimMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const NOW = new Date('2026-09-26T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeEach(() => {
  jest.clearAllMocks();
  envMock.ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES = 10;
  connectDBMock.mockResolvedValue(undefined);
  findSelectMock.mockReturnValue({ lean: findLeanMock });
  findLeanMock.mockResolvedValue({});
  claimMock.mockReturnValue({ lean: claimLeanMock });
  claimLeanMock.mockResolvedValue({ _id: 'store' });
});

describe('getCatalogSyncAvailability', () => {
  it('is open for a store that never synced', async () => {
    const { getCatalogSyncAvailability } = await import('@/app/lib/services/catalog-sync-claim');

    expect(await getCatalogSyncAvailability(STORE_ID, NOW)).toEqual({ lastSyncAt: undefined });
  });

  it('reports when the button opens again while inside the cooldown', async () => {
    findLeanMock.mockResolvedValue({ catalogLastSyncAt: minutesAgo(4) });
    const { getCatalogSyncAvailability } = await import('@/app/lib/services/catalog-sync-claim');

    const result = await getCatalogSyncAvailability(STORE_ID, NOW);

    expect(result.lastSyncAt).toBe(minutesAgo(4).toISOString());
    expect(result.nextAllowedAt).toBe(new Date(NOW.getTime() + 6 * 60_000).toISOString());
  });

  it('is open again once the cooldown has passed', async () => {
    findLeanMock.mockResolvedValue({ catalogLastSyncAt: minutesAgo(11) });
    const { getCatalogSyncAvailability } = await import('@/app/lib/services/catalog-sync-claim');

    expect(await getCatalogSyncAvailability(STORE_ID, NOW)).not.toHaveProperty('nextAllowedAt');
  });

  it('404s for an unknown store', async () => {
    findLeanMock.mockResolvedValue(null);
    const { getCatalogSyncAvailability } = await import('@/app/lib/services/catalog-sync-claim');

    await expect(getCatalogSyncAvailability(STORE_ID, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('claimCatalogSync', () => {
  it('refuses with 429 and the minutes left while cooling down, without writing', async () => {
    findLeanMock.mockResolvedValue({ catalogLastSyncAt: minutesAgo(4) });
    const { claimCatalogSync } = await import('@/app/lib/services/catalog-sync-claim');

    await expect(claimCatalogSync(STORE_ID, NOW)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('6 min'),
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('stamps the store with a conditional update once the cooldown has passed', async () => {
    findLeanMock.mockResolvedValue({ catalogLastSyncAt: minutesAgo(30) });
    const { claimCatalogSync } = await import('@/app/lib/services/catalog-sync-claim');

    await claimCatalogSync(STORE_ID, NOW);

    const [filter, update] = claimMock.mock.calls[0];
    expect(update).toEqual({ $set: { catalogLastSyncAt: NOW } });
    // Only wins while the stamp is still absent or older than the cooldown.
    expect(filter.$or).toContainEqual({ catalogLastSyncAt: { $lte: minutesAgo(10) } });
    expect(filter.$or).toContainEqual({ catalogLastSyncAt: { $exists: false } });
  });

  it('loses gracefully to a concurrent click', async () => {
    claimLeanMock.mockResolvedValue(null);
    const { claimCatalogSync } = await import('@/app/lib/services/catalog-sync-claim');

    await expect(claimCatalogSync(STORE_ID, NOW)).rejects.toMatchObject({ status: 429 });
  });

  it('a zero cooldown never refuses', async () => {
    envMock.ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES = 0;
    findLeanMock.mockResolvedValue({ catalogLastSyncAt: minutesAgo(0) });
    const { claimCatalogSync } = await import('@/app/lib/services/catalog-sync-claim');

    await expect(claimCatalogSync(STORE_ID, NOW)).resolves.toBeUndefined();
  });
});
