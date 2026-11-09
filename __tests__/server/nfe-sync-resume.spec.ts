/**
 * @jest-environment node
 */
export {};

// The resume cron: stores whose SEFAZ sync stopped with documents waiting are
// continued once the same claim the button uses lets them through.
const connectDBMock = jest.fn();
const storeFindLeanMock = jest.fn();
const storeUpdateMock = jest.fn();
const jobExistsMock = jest.fn();
const claimMock = jest.fn();
const enqueueMock = jest.fn();
const resumeAtMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/logger', () => {
  const noop = jest.fn();
  const child = { info: noop, warn: noop, error: noop };
  return { logger: { child: () => child } };
});
jest.mock('@/app/lib/errors', () => {
  class TooManyRequestsError extends Error {
    status = 429;
  }
  return { TooManyRequestsError };
});
jest.mock('@/app/lib/jobs/service', () => ({ createAndEnqueueJob: enqueueMock }));
jest.mock('@/app/lib/services/nfe-sync-claim', () => ({
  SEFAZ_SYNC_JOB_CONFIG: { attempts: 1 },
  claimSefazSync: claimMock,
}));
jest.mock('@/app/lib/services/sefaz-store-gate', () => ({ getSefazResumeAt: resumeAtMock }));
jest.mock('@/app/models/jobs', () => ({ __esModule: true, default: { exists: jobExistsMock } }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    find: () => ({ select: () => ({ limit: () => ({ lean: storeFindLeanMock }) }) }),
    updateOne: storeUpdateMock,
  },
}));

const NOW = new Date('2026-09-24T18:00:00.000Z');
const LATER = new Date('2026-09-24T19:00:00.000Z');
const STORE = { _id: '665f735a90788d97f5a76322', organizationId: '665f735a90788d97f5a76300' };

const load = () => import('@/app/lib/services/nfe-sync-resume');

beforeEach(() => {
  jest.clearAllMocks();
  storeFindLeanMock.mockResolvedValue([STORE]);
  jobExistsMock.mockResolvedValue(null);
  claimMock.mockResolvedValue(undefined);
  enqueueMock.mockResolvedValue({ dbJobId: 'j', queueJobId: 'q' });
  resumeAtMock.mockResolvedValue(LATER);
});

describe('resumePendingSefazSyncs', () => {
  it('enqueues a sefaz-mode job with one attempt and clears the pending resume after it', async () => {
    const { resumePendingSefazSyncs, SEFAZ_RESUME_REQUESTER } = await load();

    const summary = await resumePendingSefazSyncs(NOW);

    expect(summary).toEqual({ resumed: 1, deferred: 0, skipped: 0, failed: 0 });
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sefaz.nfe.received',
        organizationId: STORE.organizationId,
        config: { attempts: 1 },
        payload: { requestedByUserId: SEFAZ_RESUME_REQUESTER, storeId: STORE._id, mode: 'sefaz' },
      }),
      expect.anything(),
    );
    // Conditional, so a later resume set by a fast job survives.
    expect(storeUpdateMock).toHaveBeenCalledWith(
      { _id: STORE._id, sefazResumeAt: { $lte: NOW } },
      { $unset: { sefazResumeAt: '' } },
    );
    expect(claimMock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueMock.mock.invocationCallOrder[0] as number,
    );
  });

  it('only looks at stores whose resume time has come', async () => {
    storeFindLeanMock.mockResolvedValue([]);
    const { resumePendingSefazSyncs } = await load();

    const summary = await resumePendingSefazSyncs(NOW);

    expect(summary.resumed).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('skips a store that already has a job queued or running', async () => {
    jobExistsMock.mockResolvedValue({ _id: 'j' });
    const { resumePendingSefazSyncs } = await load();

    const summary = await resumePendingSefazSyncs(NOW);

    expect(summary).toMatchObject({ skipped: 1, resumed: 0 });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('pushes the resume time out when the claim says the quota has not reopened', async () => {
    const { TooManyRequestsError } = await import('@/app/lib/errors');
    claimMock.mockRejectedValue(new TooManyRequestsError('cooldown'));
    const { resumePendingSefazSyncs } = await load();

    const summary = await resumePendingSefazSyncs(NOW);

    expect(summary).toMatchObject({ deferred: 1, resumed: 0 });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(storeUpdateMock).toHaveBeenCalledWith(
      { _id: STORE._id },
      { $set: { sefazResumeAt: LATER } },
    );
  });

  it('does not clear the resume when enqueueing fails, and keeps going with other stores', async () => {
    const other = { _id: '665f735a90788d97f5a76323', organizationId: STORE.organizationId };
    storeFindLeanMock.mockResolvedValue([STORE, other]);
    enqueueMock.mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce({});
    const { resumePendingSefazSyncs } = await load();

    const summary = await resumePendingSefazSyncs(NOW);

    expect(summary).toMatchObject({ failed: 1, resumed: 1 });
    expect(storeUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: STORE._id }),
      expect.anything(),
    );
  });
});
