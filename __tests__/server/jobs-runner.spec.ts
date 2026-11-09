/**
 * @jest-environment node
 */
export {};

const connectDBMock = jest.fn();
const jobsFindByIdMock = jest.fn();
const jobsUpdateOneMock = jest.fn();
const handlerUsersMock = jest.fn();
const sendFailureWebhookMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: { findById: jobsFindByIdMock, updateOne: jobsUpdateOneMock },
}));
jest.mock('@/app/jobs/registry', () => ({
  jobRegistry: {
    'users.export.csv': handlerUsersMock,
  },
}));
jest.mock('@/app/lib/webhook', () => ({
  sendFailureWebhook: sendFailureWebhookMock,
  sendSuccessWebhook: jest.fn(),
}));

describe('jobs runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    jobsUpdateOneMock.mockResolvedValue({ acknowledged: true });
  });

  it('rejects unknown kind, and records the failure on the job (never leaves it "queued")', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({ _id: 'j1', kind: 'unknown.kind', payload: {} }),
    });
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');
    await expect(
      runQueuedJob({ data: { jobId: 'j1' }, id: 'bull-1', attemptsMade: 0, opts: {} } as never),
    ).rejects.toThrow('Nenhum handler registrado');

    // A worker that predates a kind (an old process after a deploy) used to
    // throw before this bookkeeping, so the job stayed "queued" forever.
    const failure = jobsUpdateOneMock.mock.calls.find((call) => call[1]?.$push?.errorLogs);
    expect(failure?.[1].$set.status).toBe('failed');
    expect(failure?.[1].$push.errorLogs.message).toContain('unknown.kind');
    // Not permanent: a retry can land on an up-to-date worker.
    expect(failure?.[1].$push.errorLogs.code).toBeUndefined();
  });

  it('persists failed status with errorLogs on handler error', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    handlerUsersMock.mockRejectedValueOnce(new Error('boom'));
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');
    await expect(
      runQueuedJob({ data: { jobId: 'j1' }, id: 'bull-2', attemptsMade: 1, opts: {} } as never),
    ).rejects.toThrow('boom');
    const pushCall = jobsUpdateOneMock.mock.calls.find((c) => c[1]?.$push?.errorLogs);
    expect(pushCall).toBeDefined();
  });

  // A permanent failure (a rejected model, an unusable payload) fails identically
  // on every attempt. Re-running it only stacks copies of the same error on the
  // job, which is what made a retired-model failure read as nine separate
  // problems instead of one.
  it('discards the queue retries for a permanent failure and records its code', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');
    handlerUsersMock.mockRejectedValueOnce(
      new PermanentJobError('model gone', 'model_unavailable'),
    );
    // Bull v4's discard() is synchronous and returns undefined — @types/bull says
    // Promise<void>, and a mock that follows the typings instead of the library
    // hid a TypeError that left every permanently-failed job stuck as "running".
    const discard = jest.fn(() => undefined);
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');

    await expect(
      runQueuedJob({
        data: { jobId: 'j1' },
        id: 'bull-4',
        attemptsMade: 0,
        opts: { attempts: 3 },
        discard,
      } as never),
    ).rejects.toThrow('model gone');

    expect(discard).toHaveBeenCalledTimes(1);
    const pushCall = jobsUpdateOneMock.mock.calls.find((c) => c[1]?.$push?.errorLogs);
    expect(pushCall?.[1].$push.errorLogs).toMatchObject({
      message: 'model gone',
      code: 'model_unavailable',
    });
    // The status write comes AFTER the discard, so anything throwing in between
    // leaves the job reading as "running" forever. That is exactly what happened.
    expect(pushCall?.[1].$set).toMatchObject({ status: 'failed' });
  });

  it('still fails the job when the queue cannot be told to stop retrying', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    const { PermanentJobError } = await import('@/app/lib/jobs/errors');
    handlerUsersMock.mockRejectedValueOnce(new PermanentJobError('model gone'));
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');

    await expect(
      runQueuedJob({
        data: { jobId: 'j1' },
        id: 'bull-4b',
        attemptsMade: 0,
        opts: { attempts: 3 },
        discard: () => {
          throw new Error('discard blew up');
        },
      } as never),
    ).rejects.toThrow('model gone'); // the original failure, not the discard's

    const pushCall = jobsUpdateOneMock.mock.calls.find((c) => c[1]?.$push?.errorLogs);
    expect(pushCall?.[1].$set).toMatchObject({ status: 'failed' });
  });

  it('leaves a non-permanent failure unlabelled rather than calling it unknown', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    handlerUsersMock.mockRejectedValueOnce(new Error('mongo went away'));
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');

    await expect(
      runQueuedJob({
        data: { jobId: 'j1' },
        id: 'bull-8',
        attemptsMade: 0,
        opts: { attempts: 6 },
        discard: jest.fn(),
      } as never),
    ).rejects.toThrow('mongo went away');

    const pushCall = jobsUpdateOneMock.mock.calls.find((c) => c[1]?.$push?.errorLogs);
    expect(pushCall?.[1].$push.errorLogs.code).toBeUndefined();
  });

  it('leaves the queue retries alone for a transient failure', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    handlerUsersMock.mockRejectedValueOnce(new Error('provider is down'));
    const discard = jest.fn();
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');

    await expect(
      runQueuedJob({
        data: { jobId: 'j1' },
        id: 'bull-5',
        attemptsMade: 0,
        opts: { attempts: 3 },
        discard,
      } as never),
    ).rejects.toThrow('provider is down');

    expect(discard).not.toHaveBeenCalled();
  });

  it('dispatches users.export.csv handler and marks done', async () => {
    jobsFindByIdMock.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        _id: 'j1',
        kind: 'users.export.csv',
        payload: { requestedByUserId: 'u1', authorizedOrganizationIds: ['e1'] },
        status: 'queued',
      }),
    });
    handlerUsersMock.mockResolvedValueOnce({ ok: true });
    const { runQueuedJob } = await import('@/app/lib/jobs/runner');
    const result = await runQueuedJob({
      data: { jobId: 'j1' },
      id: 'bull-3',
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as never);
    expect(result).toEqual({ ok: true });
    expect(handlerUsersMock).toHaveBeenCalledTimes(1);
  });
});
