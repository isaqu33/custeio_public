/**
 * @jest-environment node
 */
export {};

const captureNfeFilesForStoreMock = jest.fn();

jest.mock('@/app/lib/services/nfe-capture', () => ({
  captureNfeFilesForStore: captureNfeFilesForStoreMock,
}));

const CONTEXT = { jobId: 'job-1', bullJobId: 'bull-1', attempt: 1, maxAttempts: 1 };

describe('sefazNfeReceivedJob', () => {
  it('reports 100% and zero failures when every file processes cleanly', async () => {
    captureNfeFilesForStoreMock.mockResolvedValue({
      files: [
        { fileName: 'a.xml', status: 'processed', itemsMatched: 1, itemsDrafted: 0 },
        { fileName: 'b.xml', status: 'duplicate', itemsMatched: 0, itemsDrafted: 0 },
      ],
      totalItemsMatched: 1,
      totalItemsDrafted: 0,
    });
    const { sefazNfeReceivedJob } = await import('@/app/jobs/sefaz-nfe-received');

    const result = await sefazNfeReceivedJob(
      { requestedByUserId: 'u1', storeId: 'store-1', files: [] },
      CONTEXT,
    );

    expect(result).toMatchObject({
      totalFiles: 2,
      filesProcessed: 2,
      filesFailed: 0,
      percentComplete: 100,
      totalItemsMatched: 1,
      totalItemsDrafted: 0,
    });
  });

  it('computes a partial percentage when some files fail to parse', async () => {
    captureNfeFilesForStoreMock.mockResolvedValue({
      files: [
        { fileName: 'a.xml', status: 'processed', itemsMatched: 1, itemsDrafted: 1 },
        {
          fileName: 'b.xml',
          status: 'error',
          error: 'not valid XML',
          itemsMatched: 0,
          itemsDrafted: 0,
        },
        {
          fileName: 'c.xml',
          status: 'error',
          error: 'not valid XML',
          itemsMatched: 0,
          itemsDrafted: 0,
        },
        { fileName: 'd.xml', status: 'processed', itemsMatched: 0, itemsDrafted: 2 },
      ],
      totalItemsMatched: 1,
      totalItemsDrafted: 3,
    });
    const { sefazNfeReceivedJob } = await import('@/app/jobs/sefaz-nfe-received');

    const result = await sefazNfeReceivedJob(
      { requestedByUserId: 'u1', storeId: 'store-1', files: [] },
      CONTEXT,
    );

    expect(result).toMatchObject({
      totalFiles: 4,
      filesProcessed: 2,
      filesFailed: 2,
      percentComplete: 50,
    });
  });
});
