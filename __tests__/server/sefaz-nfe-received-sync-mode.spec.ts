/**
 * @jest-environment node
 */
export {};

// Sync mode of the job: what it reports when a run pauses, and the cap on the
// per-file list stored on the Job document.
const syncMock = jest.fn();

jest.mock('@/app/lib/services/nfe-capture', () => ({ captureNfeFilesForStore: jest.fn() }));
jest.mock('@/app/lib/services/nfe-sync', () => ({ syncNfeFromSefaz: syncMock }));

const CONTEXT = { jobId: 'job-1', bullJobId: 'bull-1', attempt: 1, maxAttempts: 1 };
const PAYLOAD = { requestedByUserId: 'u1', storeId: 'store-1', mode: 'sefaz' as const };

const file = (status: string, n: number) => ({
  fileName: `NSU-${n}.xml`,
  status,
  itemsMatched: 0,
  itemsDrafted: 0,
});

describe('sefazNfeReceivedJob in sefaz mode', () => {
  it('reports a pause as partial progress with the resume time, not as 100%', async () => {
    syncMock.mockResolvedValue({
      files: [file('processed', 1)],
      progress: {
        phase: 'paused',
        docsDone: 50,
        docsTotal: 200,
        resumeAt: '2026-09-24T19:00:00.000Z',
      },
    });
    const { sefazNfeReceivedJob } = await import('@/app/jobs/sefaz-nfe-received');

    const result = await sefazNfeReceivedJob(PAYLOAD, CONTEXT);

    expect(result).toMatchObject({
      paused: true,
      percentComplete: 25,
      resumeAt: '2026-09-24T19:00:00.000Z',
    });
  });

  it('reports a finished run as 100% and not paused', async () => {
    syncMock.mockResolvedValue({
      files: [file('processed', 1)],
      progress: { phase: 'done', docsDone: 1, docsTotal: 1 },
    });
    const { sefazNfeReceivedJob } = await import('@/app/jobs/sefaz-nfe-received');

    const result = await sefazNfeReceivedJob(PAYLOAD, CONTEXT);

    expect(result).toMatchObject({ paused: false, percentComplete: 100, filesOmitted: 0 });
  });

  it('caps the stored file list, keeping failures first, and says how many were left out', async () => {
    const { sefazNfeReceivedJob, MAX_RESULT_FILES } = await import('@/app/jobs/sefaz-nfe-received');
    const many = [
      ...Array.from({ length: MAX_RESULT_FILES + 50 }, (_, i) => file('processed', i)),
      file('error', 9999),
    ];
    syncMock.mockResolvedValue({ files: many, progress: { phase: 'done' } });

    const result = (await sefazNfeReceivedJob(PAYLOAD, CONTEXT)) as {
      files: Array<{ status: string }>;
      filesOmitted: number;
      totalFiles: number;
      filesFailed: number;
    };

    expect(result.files).toHaveLength(MAX_RESULT_FILES);
    expect(result.files[0]?.status).toBe('error');
    expect(result.filesOmitted).toBe(51);
    // Counters still describe the whole run, not the capped list.
    expect(result.totalFiles).toBe(MAX_RESULT_FILES + 51);
    expect(result.filesFailed).toBe(1);
  });
});
