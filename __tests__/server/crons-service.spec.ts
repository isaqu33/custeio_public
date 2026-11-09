/**
 * @jest-environment node
 */
export {};

// The worker's scheduler and the Crons screen share these rows. Mongo is mocked;
// what is under test is who gets to run, what is recorded, and what a failure does.
const connectDBMock = jest.fn();
const updateOneMock = jest.fn();
const findOneAndUpdateMock = jest.fn();
const findMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
const beginRecordMock = jest.fn();
const endRecordMock = jest.fn();

jest.mock('@/app/lib/logger', () => ({ logger: { error: jest.fn(), info: jest.fn() } }));
jest.mock('@/app/lib/services/cron-job-records', () => ({
  beginCronRunRecord: (...args: unknown[]) => beginRecordMock(...args),
  endCronRunRecord: (...args: unknown[]) => endRecordMock(...args),
}));
jest.mock('@/app/lib/env', () => ({
  env: { SEFAZ_RESUME_INTERVAL_MINUTES: 5, APP_BULL_CLEANUP_INTERVAL_HOURS: 6 },
}));
jest.mock('@/app/models/cron-settings', () => ({
  __esModule: true,
  default: {
    updateOne: (...args: unknown[]) => updateOneMock(...args),
    find: () => ({ lean: findMock }),
    findOneAndUpdate: (...args: unknown[]) => ({
      lean: () => findOneAndUpdateMock(...args),
    }),
  },
}));

const NOW = new Date('2026-09-24T18:00:00.000Z');
const load = () => import('@/app/lib/services/crons');

const handlers = () => ({
  'sefaz.auto-sync': jest.fn().mockResolvedValue('1 iniciada(s)'),
  'queue.cleanup': jest.fn().mockResolvedValue('0 removido(s)'),
  'bridge.pull': jest.fn().mockResolvedValue('0 evento(s)'),
});

beforeEach(() => {
  jest.clearAllMocks();
  findOneAndUpdateMock.mockResolvedValue({ key: 'x' }); // every claim succeeds unless a test says otherwise
  beginRecordMock.mockResolvedValue({ id: 'job1', startedAt: NOW });
  endRecordMock.mockResolvedValue(undefined);
});

describe('runDueCrons — the job record of each run', () => {
  it('opens a job before the handler and closes it with the summary', async () => {
    const { runDueCrons } = await load();

    await runDueCrons(handlers(), NOW);

    expect(beginRecordMock).toHaveBeenCalledWith('sefaz.auto-sync', NOW);
    expect(endRecordMock).toHaveBeenCalledWith(
      { id: 'job1', startedAt: NOW },
      { ok: true, summary: '1 iniciada(s)', idle: false, durationMs: expect.any(Number) },
    );
  });

  it('passes on that a handler found nothing to do, so the record can be dropped', async () => {
    const { runDueCrons } = await load();
    const h = handlers();
    h['queue.cleanup'].mockResolvedValue({ summary: '0 removido(s)', idle: true });

    await runDueCrons(h, NOW);

    expect(endRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ok: true, summary: '0 removido(s)', idle: true }),
    );
  });

  it('closes the job as failed when the handler throws', async () => {
    const { runDueCrons } = await load();
    const h = handlers();
    h['sefaz.auto-sync'].mockRejectedValue(new Error('redis down'));

    await runDueCrons(h, NOW);

    expect(endRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ok: false, error: 'redis down' }),
    );
  });

  it('runs the cron even when the job record cannot be written', async () => {
    beginRecordMock.mockRejectedValue(new Error('mongo down'));
    const { runDueCrons } = await load();
    const h = handlers();

    const outcomes = await runDueCrons(h, NOW);

    expect(h['sefaz.auto-sync']).toHaveBeenCalledTimes(1);
    expect(outcomes).toContainEqual({ key: 'sefaz.auto-sync', ok: true, result: '1 iniciada(s)' });
    expect(endRecordMock).not.toHaveBeenCalled();
  });
});

describe('runDueCrons', () => {
  it('runs a due cron and records its result and duration', async () => {
    const { runDueCrons } = await load();
    const h = handlers();

    const outcomes = await runDueCrons(h, NOW);

    expect(h['sefaz.auto-sync']).toHaveBeenCalledTimes(1);
    expect(outcomes).toContainEqual({ key: 'sefaz.auto-sync', ok: true, result: '1 iniciada(s)' });
    expect(updateOneMock).toHaveBeenCalledWith(
      { key: 'sefaz.auto-sync' },
      {
        $set: { lastDurationMs: expect.any(Number), lastResult: '1 iniciada(s)' },
        $unset: { lastError: '' },
      },
    );
  });

  it('claims atomically, only when enabled and past its interval', async () => {
    const { runDueCrons } = await load();

    await runDueCrons(handlers(), NOW);

    const [filter, update] = findOneAndUpdateMock.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(filter).toMatchObject({ key: 'sefaz.auto-sync', enabled: true });
    expect(filter.$expr).toBeDefined();
    expect(update).toEqual({ $set: { lastRunAt: NOW } });
  });

  it('skips a cron that is paused or not due (the claim matches nothing)', async () => {
    findOneAndUpdateMock.mockResolvedValue(null);
    const { runDueCrons } = await load();
    const h = handlers();

    const outcomes = await runDueCrons(h, NOW);

    expect(outcomes).toEqual([]);
    expect(h['sefaz.auto-sync']).not.toHaveBeenCalled();
    expect(h['queue.cleanup']).not.toHaveBeenCalled();
  });

  it('records a failure and still runs the next cron', async () => {
    const { runDueCrons } = await load();
    const h = handlers();
    h['sefaz.auto-sync'].mockRejectedValue(new Error('redis down'));

    const outcomes = await runDueCrons(h, NOW);

    expect(outcomes).toEqual([
      { key: 'sefaz.auto-sync', ok: false, error: 'redis down' },
      { key: 'queue.cleanup', ok: true, result: '0 removido(s)' },
      { key: 'bridge.pull', ok: true, result: '0 evento(s)' },
    ]);
    expect(updateOneMock).toHaveBeenCalledWith(
      { key: 'sefaz.auto-sync' },
      { $set: { lastDurationMs: expect.any(Number), lastError: 'redis down' } },
    );
    expect(h['queue.cleanup']).toHaveBeenCalled();
  });

  it('seeds a missing row with the defaults from the definition', async () => {
    const { runDueCrons } = await load();

    await runDueCrons(handlers(), NOW);

    expect(updateOneMock).toHaveBeenCalledWith(
      { key: 'sefaz.auto-sync' },
      { $setOnInsert: { enabled: true, intervalMinutes: 5 } },
      { upsert: true },
    );
    expect(updateOneMock).toHaveBeenCalledWith(
      { key: 'queue.cleanup' },
      { $setOnInsert: { enabled: true, intervalMinutes: 360 } },
      { upsert: true },
    );
  });
});

describe('updateCron', () => {
  it('pauses a cron and says who did it', async () => {
    findOneAndUpdateMock.mockResolvedValue({
      key: 'sefaz.auto-sync',
      enabled: false,
      intervalMinutes: 5,
    });
    const { updateCron } = await load();

    const row = await updateCron('sefaz.auto-sync', { enabled: false }, 'user-1');

    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { key: 'sefaz.auto-sync' },
      { $set: { updatedByUserId: 'user-1', enabled: false } },
      { returnDocument: 'after' },
    );
    expect(row).toMatchObject({ enabled: false, intervalMinutes: 5, nextRunAt: undefined });
  });

  it('changes only the interval when only the interval is sent', async () => {
    findOneAndUpdateMock.mockResolvedValue({
      key: 'sefaz.auto-sync',
      enabled: true,
      intervalMinutes: 30,
      lastRunAt: NOW,
    });
    const { updateCron } = await load();

    const row = await updateCron('sefaz.auto-sync', { intervalMinutes: 30 });

    expect(findOneAndUpdateMock.mock.calls[0]?.[1]).toEqual({
      $set: { updatedByUserId: undefined, intervalMinutes: 30 },
    });
    expect(row?.nextRunAt).toBe('2026-09-24T18:30:00.000Z');
  });
});

describe('toCronRow', () => {
  it('has no next run while paused', async () => {
    const { toCronRow } = await load();
    const { getCronDefinitions } = await import('@/app/lib/crons/definitions');
    const [definition] = getCronDefinitions();

    const row = toCronRow(definition!, {
      key: definition!.key,
      enabled: false,
      intervalMinutes: 5,
    });

    expect(row.nextRunAt).toBeUndefined();
    expect(row.defaultIntervalMinutes).toBe(5);
  });
});
