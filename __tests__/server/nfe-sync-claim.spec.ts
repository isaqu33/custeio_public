/**
 * @jest-environment node
 */
export {};

// The claim is what stops an owner from mashing the button into SEFAZ's 20/h
// ceiling: gate first, then an atomic conditional stamp so two simultaneous
// clicks cannot both win.
const connectDBMock = jest.fn();
const storeFindLeanMock = jest.fn();
const storeClaimLeanMock = jest.fn();
const storeClaimMock = jest.fn(() => ({ lean: storeClaimLeanMock }));
const usageMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/env', () => ({ env: { SEFAZ_SYNC_COOLDOWN_MINUTES: 60 } }));
jest.mock('@/app/lib/errors', () => {
  class TooManyRequestsError extends Error {
    status = 429;
  }
  class NotFoundError extends Error {
    status = 404;
  }
  return { TooManyRequestsError, NotFoundError };
});
jest.mock('@/app/lib/services/sefaz-requests', () => ({ getSefazUsageByStore: usageMock }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: () => ({ lean: storeFindLeanMock }) }),
    findOneAndUpdate: storeClaimMock,
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const NOW = new Date('2026-09-24T18:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const load = () => import('@/app/lib/services/nfe-sync-claim');

beforeEach(() => {
  jest.clearAllMocks();
  usageMock.mockResolvedValue(new Map());
  storeFindLeanMock.mockResolvedValue({});
  storeClaimLeanMock.mockResolvedValue({ _id: STORE_ID });
});

describe('claimSefazSync', () => {
  it('stamps the store atomically when the gate is open', async () => {
    const { claimSefazSync } = await load();
    await claimSefazSync(STORE_ID, NOW);

    expect(storeClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ sefazLastSyncAt: { $lte: minutesAgo(60) } }]),
      }),
      { $set: { sefazLastSyncAt: NOW } },
    );
  });

  it('refuses inside the cooldown without stamping anything', async () => {
    storeFindLeanMock.mockResolvedValue({ sefazLastSyncAt: minutesAgo(10) });
    const { claimSefazSync } = await load();

    await expect(claimSefazSync(STORE_ID, NOW)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('50 min'),
    });
    expect(storeClaimMock).not.toHaveBeenCalled();
  });

  it('refuses while SEFAZ has the CNPJ blocked', async () => {
    usageMock.mockResolvedValue(
      new Map([
        [
          STORE_ID,
          {
            production: {
              usedLastHour: 1,
              limit: 20,
              blockedUntil: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
            },
          },
        ],
      ]),
    );
    const { claimSefazSync } = await load();

    await expect(claimSefazSync(STORE_ID, NOW)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('blocked'),
    });
  });

  it('refuses near the hourly ceiling', async () => {
    usageMock.mockResolvedValue(
      new Map([[STORE_ID, { production: { usedLastHour: 16, limit: 20 } }]]),
    );
    const { claimSefazSync } = await load();

    await expect(claimSefazSync(STORE_ID, NOW)).rejects.toMatchObject({ status: 429 });
  });

  it('loses gracefully to a concurrent click that stamped first', async () => {
    storeClaimLeanMock.mockResolvedValue(null);
    storeFindLeanMock
      .mockResolvedValueOnce({}) // first look: open
      .mockResolvedValueOnce({ sefazLastSyncAt: NOW }); // re-read: the other click won
    const { claimSefazSync } = await load();

    await expect(claimSefazSync(STORE_ID, NOW)).rejects.toMatchObject({ status: 429 });
  });
});

describe('getSefazSyncAvailability', () => {
  it('reports when the button opens again during a cooldown', async () => {
    storeFindLeanMock.mockResolvedValue({ sefazLastSyncAt: minutesAgo(15) });
    const { getSefazSyncAvailability } = await load();

    const result = await getSefazSyncAvailability(STORE_ID, NOW);
    expect(result).toMatchObject({ reason: 'cooldown' });
    expect(result.nextAllowedAt).toBe(new Date(NOW.getTime() + 45 * 60_000).toISOString());
  });

  it('reports nothing to wait for when the gate is open', async () => {
    const { getSefazSyncAvailability } = await load();
    expect(await getSefazSyncAvailability(STORE_ID, NOW)).toEqual({ lastSyncAt: undefined });
  });
});
