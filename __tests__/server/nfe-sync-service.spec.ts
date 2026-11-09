/**
 * @jest-environment node
 */
export {};

// "Buscar na SEFAZ": batches in, invoices captured, progress + logs + cursor
// written as it goes. Source, capture and models are mocked — the pure pieces
// (batching, forecast, gate) have their own specs.
const connectDBMock = jest.fn();
const jobUpdateMock = jest.fn();
const storeFindLeanMock = jest.fn();
const storeUpdateMock = jest.fn();
const appendJobLogMock = jest.fn();
const applyCancellationMock = jest.fn();
const reserveRequestMock = jest.fn();
const settleRequestMock = jest.fn();
const evaluateGateMock = jest.fn();
const resumeAtMock = jest.fn();
const captureOneFileMock = jest.fn();
const recordSummaryMock = jest.fn();
const fetchBatchMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/logger', () => {
  const noop = jest.fn();
  const child = { info: noop, warn: noop, error: noop };
  return { logger: { child: () => child } };
});
jest.mock('@/app/lib/jobs/log', () => ({ appendJobLog: appendJobLogMock }));
jest.mock('@/app/lib/services/sefaz-requests', () => ({
  reserveSefazRequest: reserveRequestMock,
  settleSefazRequest: settleRequestMock,
}));
jest.mock('@/app/lib/services/sefaz-store-gate', () => ({
  evaluateStoreGate: evaluateGateMock,
  getSefazResumeAt: resumeAtMock,
}));
jest.mock('@/app/lib/services/nfe-cancellation', () => ({
  applyInvoiceCancellation: applyCancellationMock,
}));
jest.mock('@/app/lib/services/nfe-capture', () => ({ captureOneFile: captureOneFileMock }));
jest.mock('@/app/lib/services/nfe-documents', () => ({ recordNfeSummary: recordSummaryMock }));
jest.mock('@/app/lib/sefaz-source', () => ({
  SEFAZ_BATCH_SIZE: 2, // tiny so "a full batch" is easy to build
  fetchSefazBatch: fetchBatchMock,
  isSimulatedSource: () => true,
}));
jest.mock('@/app/models/jobs', () => ({ __esModule: true, default: { updateOne: jobUpdateMock } }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: {
    findById: () => ({ select: () => ({ lean: storeFindLeanMock }) }),
    updateOne: storeUpdateMock,
  },
}));

import { PermanentJobError } from '@/app/lib/jobs/errors';
import { SefazBlockedError } from '@/app/lib/sefaz-client';
// Imported lazily: the mock factories above close over `const` mocks that are
// not initialized yet while static imports are hoisted.
const loadService = () => import('@/app/lib/services/nfe-sync');
async function syncNfeFromSefaz(storeId: string, context: { jobId: string }) {
  return (await loadService()).syncNfeFromSefaz(storeId, context);
}

const STORE_ID = '665f735a90788d97f5a76322';
const JOB_ID = '665f735a90788d97f5a76399';
const RESUME_AT = new Date('2026-09-24T19:00:00.000Z');
const nsu = (n: number) => String(n).padStart(15, '0');
const proc = (n: number) => ({ nsu: nsu(n), schema: 'procNFe_v4.00.xsd', xml: `<nfe n="${n}"/>` });
const SUMMARY_KEY = '53261081611931002252550030012040341199141519';
const res = (n: number) => ({
  nsu: nsu(n),
  schema: 'resNFe_v1.01.xsd',
  xml: `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${SUMMARY_KEY}</chNFe><CNPJ>81611931002252</CNPJ><xNome>OESA</xNome><dhEmi>2026-10-06T03:38:00-03:00</dhEmi><vNF>1100.73</vNF></resNFe>`,
});

const EVENT_KEY = '35260912345678000199550010000000011234567890';
const cancelEvent = (n: number, tpEvento = '110111') => ({
  nsu: nsu(n),
  schema: 'resEvento_v1.01.xsd',
  xml: `<resEvento><chNFe>${EVENT_KEY}</chNFe><tpEvento>${tpEvento}</tpEvento><dhEvento>2026-09-20T10:00:00-03:00</dhEvento></resEvento>`,
});

const batch = (documents: ReturnType<typeof proc>[], maxNSU: number, extra = {}) => ({
  cStat: documents.length ? '138' : '137',
  xMotivo: 'x',
  ultNSU: documents.length ? (documents[documents.length - 1] as { nsu: string }).nsu : nsu(0),
  maxNSU: nsu(maxNSU),
  documents,
  simulated: true,
  ...extra,
});

const lastProgress = () => {
  const calls = jobUpdateMock.mock.calls.filter((c) => c[1]?.$set?.['progress.nfe']);
  // Snapshot of the object at call time is not kept by Jest (same reference), so
  // the last write is the final state.
  return calls[calls.length - 1]?.[1].$set['progress.nfe'];
};

beforeEach(() => {
  jest.clearAllMocks();
  reserveRequestMock.mockResolvedValue('req-1');
  evaluateGateMock.mockResolvedValue({ gate: { allowed: true } });
  resumeAtMock.mockResolvedValue(RESUME_AT);
  storeFindLeanMock.mockResolvedValue({ name: 'Loja Piloto', sefazUltNsu: undefined });
  captureOneFileMock.mockResolvedValue({
    fileName: 'f',
    status: 'processed',
    itemsMatched: 2,
    itemsDrafted: 1,
  });
});

describe('polling a store with no backlog', () => {
  const pollingStore = (extra = {}) => ({
    name: 'Loja Piloto',
    sefazUltNsu: undefined,
    sefazPollEnabled: true,
    sefazPollIntervalMinutes: 90,
    ...extra,
  });
  const scheduled = () =>
    storeUpdateMock.mock.calls.find((c) => c[1]?.$set?.sefazResumeAt !== undefined)?.[1];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T18:00:00.000Z'));
    resumeAtMock.mockImplementation(async (_id: string, now: Date) => now); // gate open
  });
  afterEach(() => jest.useRealTimers());

  it('schedules the next check one interval away when polling is on', async () => {
    storeFindLeanMock.mockResolvedValue(pollingStore());
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(scheduled()?.$set).toMatchObject({
      sefazResumeAt: new Date('2026-09-24T19:30:00.000Z'),
      sefazBacklog: false,
    });
    expect(progress.resumeAt).toBe('2026-09-24T19:30:00.000Z');
    expect(appendJobLogMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ step: 'poll-scheduled' }),
    );
  });

  it('never schedules before the gate reopens', async () => {
    storeFindLeanMock.mockResolvedValue(pollingStore());
    resumeAtMock.mockResolvedValue(new Date('2026-09-24T22:00:00.000Z'));
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

    await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(scheduled()?.$set.sefazResumeAt).toEqual(new Date('2026-09-24T22:00:00.000Z'));
  });

  it('schedules nothing when polling is off', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

    await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(scheduled()).toBeUndefined();
  });

  it('keeps a backlog resuming at the gate, not at the poll interval', async () => {
    storeFindLeanMock.mockResolvedValue(pollingStore());
    resumeAtMock.mockResolvedValue(new Date('2026-09-24T18:05:00.000Z'));
    fetchBatchMock.mockImplementation(async ({ ultNSU }: { ultNSU: string }) => {
      const n = Number(ultNSU);
      return batch([proc(n + 1), proc(n + 2)], 1000);
    });

    await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(scheduled()?.$set).toMatchObject({
      sefazResumeAt: new Date('2026-09-24T18:05:00.000Z'),
      sefazBacklog: true,
    });
  });

  it('keeps polling after a failure, recording why', async () => {
    storeFindLeanMock.mockResolvedValue(pollingStore());
    fetchBatchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toThrow('socket hang up');

    expect(scheduled()?.$set).toMatchObject({
      sefazLastError: 'socket hang up',
      sefazResumeAt: new Date('2026-09-24T19:30:00.000Z'),
    });
  });

  it('records the failure but schedules nothing when polling is off', async () => {
    fetchBatchMock.mockRejectedValueOnce(new Error('boom'));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toThrow('boom');

    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({ sefazLastError: 'boom' }),
    });
    expect(scheduled()).toBeUndefined();
  });
});

describe('cancellation events', () => {
  it('gives the stock back for a cancelled invoice and reports the money', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([cancelEvent(5)], 5));
    applyCancellationMock.mockResolvedValue({
      status: 'reversed',
      lines: 3,
      reversedValue: 1234.5,
    });

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(applyCancellationMock).toHaveBeenCalledWith(STORE_ID, EVENT_KEY, {
      cancelledAt: new Date('2026-09-20T13:00:00.000Z'),
      nsu: nsu(5),
    });
    expect(progress).toMatchObject({
      invoicesCancelled: 1,
      cancelledValue: 1234.5,
      docsIgnored: 0,
    });
    expect(appendJobLogMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        step: 'nfe-cancelled',
        message: expect.stringMatching(/1\.234,50.*3 linha/),
      }),
    );
    expect(captureOneFileMock).not.toHaveBeenCalled();
  });

  it('only counts an event that is not a cancellation', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([cancelEvent(5, '110110')], 5));

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(applyCancellationMock).not.toHaveBeenCalled();
    expect(progress).toMatchObject({ docsIgnored: 1, invoicesCancelled: 0 });
  });

  it('remembers a cancellation for an invoice not captured yet', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([cancelEvent(5)], 5));
    applyCancellationMock.mockResolvedValue({ status: 'recorded' });

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(progress).toMatchObject({ invoicesCancelled: 0, docsIgnored: 1 });
    expect(appendJobLogMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        step: 'nfe-cancelled',
        message: expect.stringContaining('ainda não capturada'),
      }),
    );
  });

  it('counts a captured invoice that SEFAZ had already cancelled', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));
    captureOneFileMock.mockResolvedValueOnce({
      fileName: 'f',
      status: 'cancelled',
      itemsMatched: 0,
      itemsDrafted: 0,
    });

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(progress).toMatchObject({
      invoicesCancelled: 1,
      invoicesProcessed: 0,
      invoicesFailed: 0,
    });
  });

  it('does not swallow a failure to apply one, so the cursor stays put', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([cancelEvent(5)], 5));
    applyCancellationMock.mockRejectedValue(new Error('db down'));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toThrow('db down');

    expect(storeUpdateMock).not.toHaveBeenCalledWith(expect.anything(), {
      $set: { sefazUltNsu: nsu(5) },
    });
  });
});

describe('syncNfeFromSefaz', () => {
  it('captures full NFes, keeps summaries for the Notas screen, and saves the cursor', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([res(10), proc(11)], 11));

    const summary = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(captureOneFileMock).toHaveBeenCalledTimes(1);
    expect(captureOneFileMock).toHaveBeenCalledWith(
      STORE_ID,
      { fileName: `NSU-${nsu(11)}.xml`, content: '<nfe n="11"/>' },
      { source: 'sefaz', nsu: nsu(11) },
    );
    expect(recordSummaryMock).toHaveBeenCalledWith(
      STORE_ID,
      expect.objectContaining({
        accessKey: SUMMARY_KEY,
        supplierName: 'OESA',
        supplierCnpj: '81611931002252',
        totalValue: 1100.73,
      }),
      { nsu: nsu(10) },
    );
    expect(summary.progress).toMatchObject({
      phase: 'done',
      source: 'simulated',
      invoicesProcessed: 1,
      summariesRecorded: 1,
      docsIgnored: 0,
      itemsMatched: 2,
      itemsDrafted: 1,
      docsDone: 2,
      ultNsu: nsu(11),
    });
    expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      $set: { sefazUltNsu: nsu(11) },
    });
    // NSUs before the first delivered document are empty, not pending work.
    expect(summary.progress.docsTotal).toBe(2);
  });

  it('only counts a summary it cannot read, without stopping the batch', async () => {
    fetchBatchMock.mockResolvedValueOnce(
      batch([{ nsu: nsu(10), schema: 'resNFe_v1.01.xsd', xml: '<res n="10"/>' }, proc(11)], 11),
    );

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(recordSummaryMock).not.toHaveBeenCalled();
    expect(progress).toMatchObject({ docsIgnored: 1, summariesRecorded: 0, invoicesProcessed: 1 });
  });

  it('does not swallow a failure to remember a summary, so the cursor stays put', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([res(10)], 10));
    recordSummaryMock.mockRejectedValue(new Error('db down'));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toThrow('db down');

    expect(storeUpdateMock).not.toHaveBeenCalledWith(expect.anything(), {
      $set: { sefazUltNsu: nsu(10) },
    });
  });

  it('resumes from the stored cursor', async () => {
    storeFindLeanMock.mockResolvedValue({ name: 'Loja Piloto', sefazUltNsu: nsu(200) });
    fetchBatchMock.mockResolvedValueOnce(batch([], 200));

    await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(fetchBatchMock).toHaveBeenCalledWith({ ultNSU: nsu(200) });
  });

  it('keeps pulling while batches come back full, then stops when the sequence ends', async () => {
    fetchBatchMock
      .mockResolvedValueOnce(batch([proc(1), proc(2)], 3))
      .mockResolvedValueOnce(batch([proc(3)], 3));

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(fetchBatchMock).toHaveBeenCalledTimes(2);
    expect(fetchBatchMock).toHaveBeenLastCalledWith({ ultNSU: nsu(2) });
    expect(progress).toMatchObject({ invoicesProcessed: 3, batchesDone: 2 });
  });

  it('never pulls more than the per-run batch budget', async () => {
    fetchBatchMock.mockImplementation(async ({ ultNSU }: { ultNSU: string }) => {
      const n = Number(ultNSU);
      return batch([proc(n + 1), proc(n + 2)], 1000);
    });

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(fetchBatchMock).toHaveBeenCalledTimes((await loadService()).MAX_BATCHES_PER_RUN);
    expect(progress.phase).toBe('done');
    expect(appendJobLogMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ step: 'batch-cap' }),
    );
  });

  describe('backlog and resume', () => {
    const resumeWrite = () =>
      storeUpdateMock.mock.calls.find(
        (c) => c[1]?.$set?.sefazResumeAt || c[1]?.$unset?.sefazResumeAt !== undefined,
      )?.[1];

    it('schedules a resume when the batch budget ends with documents still waiting', async () => {
      fetchBatchMock.mockImplementation(async ({ ultNSU }: { ultNSU: string }) => {
        const n = Number(ultNSU);
        return batch([proc(n + 1), proc(n + 2)], 1000);
      });

      const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

      expect(resumeWrite()).toMatchObject({
        $set: { sefazResumeAt: RESUME_AT, sefazBacklog: true, sefazBacklogMaxNsu: nsu(1000) },
      });
      expect(progress.resumeAt).toBe(RESUME_AT.toISOString());
    });

    it('clears any pending resume once SEFAZ has nothing left', async () => {
      fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

      await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

      expect(resumeWrite()).toMatchObject({
        $set: { sefazBacklog: false },
        $unset: { sefazResumeAt: '', sefazBacklogMaxNsu: '' },
      });
    });

    it('pauses before a batch when the quota is used up, keeping the cursor', async () => {
      fetchBatchMock.mockResolvedValueOnce(batch([proc(1), proc(2)], 100));
      evaluateGateMock.mockResolvedValueOnce({ gate: { allowed: true } }).mockResolvedValueOnce({
        gate: { allowed: false, reason: 'quota', retryAfterSeconds: 3600 },
      });

      const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

      // One batch pulled, the second never asked of SEFAZ.
      expect(fetchBatchMock).toHaveBeenCalledTimes(1);
      expect(progress).toMatchObject({ phase: 'paused', ultNsu: nsu(2), invoicesProcessed: 2 });
      expect(storeUpdateMock).toHaveBeenCalledWith(expect.anything(), {
        $set: { sefazUltNsu: nsu(2) },
      });
      expect(resumeWrite()).toMatchObject({
        $set: { sefazResumeAt: RESUME_AT, sefazBacklog: true, sefazBacklogMaxNsu: nsu(100) },
      });
      expect(appendJobLogMock).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({ step: 'quota-paused' }),
      );
    });

    it('checks the quota ignoring the cooldown its own claim started', async () => {
      fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

      await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

      expect(evaluateGateMock).toHaveBeenCalledWith(STORE_ID, expect.any(Date), {
        ignoreCooldown: true,
      });
    });

    it('ends as a clean pause, not a failure, even when it pauses on the first batch', async () => {
      evaluateGateMock.mockResolvedValue({
        gate: { allowed: false, reason: 'blocked', retryAfterSeconds: 600 },
      });

      const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

      expect(fetchBatchMock).not.toHaveBeenCalled();
      expect(reserveRequestMock).not.toHaveBeenCalled();
      expect(progress.phase).toBe('paused');
    });
  });

  it('books the query before the call and keeps it counted when the call fails', async () => {
    fetchBatchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toThrow('socket hang up');

    expect(reserveRequestMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchBatchMock.mock.invocationCallOrder[0] as number,
    );
    expect(settleRequestMock).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ cStat: 'error', xMotivo: 'socket hang up' }),
    );
  });

  it('counts duplicates and failures apart, and logs the failure', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1), proc(2)], 2));
    captureOneFileMock
      .mockResolvedValueOnce({
        fileName: 'a',
        status: 'duplicate',
        itemsMatched: 0,
        itemsDrafted: 0,
      })
      .mockResolvedValueOnce({
        fileName: 'b',
        status: 'error',
        error: 'bad xml',
        itemsMatched: 0,
        itemsDrafted: 0,
      });

    const { progress } = await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    expect(progress).toMatchObject({
      invoicesDuplicate: 1,
      invoicesFailed: 1,
      invoicesProcessed: 0,
    });
    expect(appendJobLogMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ step: 'nfe-error', message: expect.stringContaining('bad xml') }),
    );
  });

  it('writes live progress and a step log as it goes', async () => {
    fetchBatchMock.mockResolvedValueOnce(batch([proc(1)], 1));

    await syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID });

    const steps = appendJobLogMock.mock.calls.map((c) => c[1].step);
    expect(steps).toEqual(['sync-start', 'sefaz-fetch', 'cursor-saved', 'sync-done']);
    expect(lastProgress()).toMatchObject({ phase: 'done', docsDone: 1, docsTotal: 1 });
    expect(reserveRequestMock).toHaveBeenCalledWith({
      storeId: STORE_ID,
      tpAmb: 1,
      simulated: true,
    });
    expect(settleRequestMock).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ cStat: '138', simulated: true }),
    );
  });

  it('fails the job for good when SEFAZ blocks the CNPJ, and logs the block', async () => {
    const until = new Date('2026-09-24T20:00:00.000Z');
    fetchBatchMock.mockRejectedValueOnce(new SefazBlockedError('SEFAZ 656', until));

    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    expect(settleRequestMock).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ cStat: '656', blockedUntil: until }),
    );
    expect(lastProgress()).toMatchObject({ phase: 'blocked' });
  });

  it('rejects an unknown store as a permanent failure', async () => {
    storeFindLeanMock.mockResolvedValue(null);
    await expect(syncNfeFromSefaz(STORE_ID, { jobId: JOB_ID })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });
});
