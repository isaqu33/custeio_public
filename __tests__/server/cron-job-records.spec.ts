/**
 * @jest-environment node
 */
export {};

// Each run of a cron is a job in Sistema > Jobs — platform-level, and an idle success leaves no trace.
const connectDBMock = jest.fn();
const createMock = jest.fn();
const updateOneMock = jest.fn();
const deleteOneMock = jest.fn();
const deleteManyMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: {
    create: createMock,
    updateOne: updateOneMock,
    deleteOne: deleteOneMock,
    deleteMany: deleteManyMock,
  },
}));

const NOW = new Date('2026-10-02T21:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({ _id: 'job1' });
});

describe('beginCronRunRecord', () => {
  it('opens a running, organization-less job of kind cron.<key>', async () => {
    const { beginCronRunRecord } = await import('@/app/lib/services/cron-job-records');

    const record = await beginCronRunRecord('sefaz.auto-sync', NOW);

    expect(record).toEqual({ id: 'job1', startedAt: NOW });
    const doc = createMock.mock.calls[0]?.[0];
    expect(doc).toMatchObject({
      kind: 'cron.sefaz.auto-sync',
      type: 'Cron',
      status: 'running',
      payload: { cron: 'sefaz.auto-sync' },
      queue: { provider: 'scheduler', queueName: 'crons' },
    });
    expect(doc).not.toHaveProperty('organizationId');
    expect(doc.examId).toBe(`CRON-sefaz.auto-sync-${NOW.getTime()}`);
  });
});

describe('endCronRunRecord', () => {
  const record = { id: 'job1', startedAt: NOW };

  it('keeps a run that did something, with its summary and duration', async () => {
    const { endCronRunRecord } = await import('@/app/lib/services/cron-job-records');

    await endCronRunRecord(record, {
      ok: true,
      summary: '2 iniciada(s)',
      idle: false,
      durationMs: 840,
    });

    expect(deleteOneMock).not.toHaveBeenCalled();
    const [filter, update] = updateOneMock.mock.calls[0] ?? [];
    expect(filter).toEqual({ _id: 'job1' });
    expect(update.$set).toMatchObject({
      status: 'done',
      result: { summary: '2 iniciada(s)', durationMs: 840 },
    });
    expect(update.$push.logs).toMatchObject({ jobStatus: 'done', step: 'cron-end' });
  });

  it('leaves no trace of an idle success, so a frequent cron does not bury real jobs', async () => {
    const { endCronRunRecord } = await import('@/app/lib/services/cron-job-records');

    await endCronRunRecord(record, {
      ok: true,
      summary: '0 iniciada(s)',
      idle: true,
      durationMs: 12,
    });

    expect(deleteOneMock).toHaveBeenCalledWith({ _id: 'job1' });
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('keeps a failure, even from an otherwise idle cron', async () => {
    const { endCronRunRecord } = await import('@/app/lib/services/cron-job-records');

    await endCronRunRecord(record, { ok: false, error: 'redis down', durationMs: 30 });

    expect(deleteOneMock).not.toHaveBeenCalled();
    const update = updateOneMock.mock.calls[0]?.[1];
    expect(update.$set).toMatchObject({
      status: 'failed',
      result: { error: 'redis down', durationMs: 30 },
    });
    expect(update.$set.errorLogs[0]).toMatchObject({ message: 'redis down' });
  });
});

describe('purgeOldCronRunRecords', () => {
  it('drops only cron runs older than the window', async () => {
    deleteManyMock.mockResolvedValue({ deletedCount: 7 });
    const { purgeOldCronRunRecords } = await import('@/app/lib/services/cron-job-records');

    await expect(purgeOldCronRunRecords(14, NOW)).resolves.toBe(7);

    const filter = deleteManyMock.mock.calls[0]?.[0];
    expect(filter.kind).toEqual({ $regex: '^cron\\.' });
    expect(filter.createdAt.$lt.toISOString()).toBe('2026-09-18T21:00:00.000Z');
  });
});
