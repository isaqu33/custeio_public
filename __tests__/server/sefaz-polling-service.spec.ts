/**
 * @jest-environment node
 */
export {};

// Turning a store's automatic SEFAZ search on/off and moving its next run.
const connectDBMock = jest.fn();
const storeFindByIdLeanMock = jest.fn();
const storeUpdateMock = jest.fn();
const resumeAtMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/services/sefaz-store-gate', () => ({ getSefazResumeAt: resumeAtMock }));
jest.mock('@/app/models/organizations', () => ({ __esModule: true, default: {} }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: () => ({ lean: storeFindByIdLeanMock }) }),
    updateOne: (...args: unknown[]) => storeUpdateMock(...args),
  },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const ORG_ID = '665f735a90788d97f5a76300';
const NOW = new Date('2026-09-24T18:00:00.000Z');
const load = () => import('@/app/lib/services/sefaz-polling');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  resumeAtMock.mockImplementation(async (_id: string, now: Date) => now); // gate open
  storeFindByIdLeanMock.mockResolvedValue({ organizationId: ORG_ID });
});
afterEach(() => jest.useRealTimers());

describe('updateStorePolling', () => {
  it('returns null for an unknown store without writing', async () => {
    storeFindByIdLeanMock.mockResolvedValue(null);
    const { updateStorePolling } = await load();

    expect(await updateStorePolling(STORE_ID, { enabled: true })).toBeNull();
    expect(storeUpdateMock).not.toHaveBeenCalled();
  });

  it('turning it on schedules a run one interval after the last search', async () => {
    storeFindByIdLeanMock.mockResolvedValue({
      organizationId: ORG_ID,
      sefazLastSyncAt: new Date('2026-09-24T17:30:00.000Z'),
    });
    const { updateStorePolling } = await load();

    const result = await updateStorePolling(STORE_ID, { enabled: true, intervalMinutes: 60 });

    expect(result).toEqual({ organizationId: ORG_ID });
    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: {
        sefazPollEnabled: true,
        sefazPollIntervalMinutes: 60,
        sefazResumeAt: new Date('2026-09-24T18:30:00.000Z'),
      },
    });
  });

  it('never schedules in the past: a store not searched for days runs right away', async () => {
    storeFindByIdLeanMock.mockResolvedValue({
      organizationId: ORG_ID,
      sefazLastSyncAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const { updateStorePolling } = await load();

    await updateStorePolling(STORE_ID, { enabled: true });

    const set = storeUpdateMock.mock.calls[0]?.[1].$set;
    expect(set.sefazResumeAt).toEqual(NOW);
  });

  it('waits for the gate when it reopens later', async () => {
    resumeAtMock.mockResolvedValue(new Date('2026-09-24T21:00:00.000Z'));
    const { updateStorePolling } = await load();

    await updateStorePolling(STORE_ID, { enabled: true });

    expect(storeUpdateMock.mock.calls[0]?.[1].$set.sefazResumeAt).toEqual(
      new Date('2026-09-24T21:00:00.000Z'),
    );
  });

  it('turning it off drops a scheduled poll', async () => {
    storeFindByIdLeanMock.mockResolvedValue({ organizationId: ORG_ID, sefazPollEnabled: true });
    const { updateStorePolling } = await load();

    await updateStorePolling(STORE_ID, { enabled: false });

    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: { sefazPollEnabled: false, sefazPollIntervalMinutes: 60 },
      $unset: { sefazResumeAt: '' },
    });
  });

  it('turning it off leaves a backlog resuming', async () => {
    storeFindByIdLeanMock.mockResolvedValue({
      organizationId: ORG_ID,
      sefazPollEnabled: true,
      sefazBacklog: true,
    });
    const { updateStorePolling } = await load();

    await updateStorePolling(STORE_ID, { enabled: false });

    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: { sefazPollEnabled: false, sefazPollIntervalMinutes: 60 },
    });
  });

  it('changing only the interval keeps polling on', async () => {
    storeFindByIdLeanMock.mockResolvedValue({
      organizationId: ORG_ID,
      sefazPollEnabled: true,
      sefazPollIntervalMinutes: 60,
      sefazLastSyncAt: new Date('2026-09-24T17:50:00.000Z'),
    });
    const { updateStorePolling } = await load();

    await updateStorePolling(STORE_ID, { intervalMinutes: 120 });

    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: {
        sefazPollEnabled: true,
        sefazPollIntervalMinutes: 120,
        sefazResumeAt: new Date('2026-09-24T19:50:00.000Z'),
      },
    });
  });
});
