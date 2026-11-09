import { BlobServiceClient, type BlobDeleteIfExistsResponse } from '@azure/storage-blob';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { env } from './env';

type AzureClient = {
  blobServiceClient: BlobServiceClient;
};

let cachedClient: AzureClient | null = null;

function getAzureClient(): AzureClient {
  if (cachedClient) return cachedClient;

  const connectionString = env.APP_AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('APP_AZURE_STORAGE_CONNECTION_STRING is not defined');
  }

  const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
  const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];
  if (!accountName || !accountKey) {
    throw new Error(
      'Could not extract account credentials from APP_AZURE_STORAGE_CONNECTION_STRING',
    );
  }

  cachedClient = {
    blobServiceClient: BlobServiceClient.fromConnectionString(connectionString),
  };
  return cachedClient;
}

export class AzuriteBlobAdapter {
  private containerName: string;

  constructor(containerName: string) {
    this.containerName = containerName;
  }

  async uploadFile(fileBuffer: Buffer, blobName: string): Promise<string> {
    const { blobServiceClient } = getAzureClient();
    const containerClient = blobServiceClient.getContainerClient(this.containerName);

    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(fileBuffer);

    return blobName;
  }

  async uploadReadableStream(
    source: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    blobName: string,
  ): Promise<string> {
    const { blobServiceClient } = getAzureClient();
    const containerClient = blobServiceClient.getContainerClient(this.containerName);

    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const stream =
      source instanceof Readable
        ? source
        : Readable.fromWeb(source as unknown as NodeReadableStream);
    await blockBlobClient.uploadStream(stream);

    return blobName;
  }

  // Walk the blobs under a prefix. Used by housekeeping (the chat-attachment sweep);
  // the request paths never list, they address a blob directly.
  async *listBlobs(prefix: string): AsyncGenerator<{ name: string; createdOn?: Date }> {
    const { blobServiceClient } = getAzureClient();
    const containerClient = blobServiceClient.getContainerClient(this.containerName);
    if (!(await containerClient.exists())) return;
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      yield { name: blob.name, createdOn: blob.properties.createdOn };
    }
  }

  async deleteBlobIfExists(blobName: string): Promise<BlobDeleteIfExistsResponse> {
    const { blobServiceClient } = getAzureClient();
    const containerClient = blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    return blockBlobClient.deleteIfExists();
  }

  // `maxRetryRequests` makes the returned stream transparently re-issue the
  // download (resuming from the last byte) when the underlying socket drops
  // mid-read — essential for long-lived streams over a large study zip.
  async downloadFile(blobName: string, maxRetryRequests = env.APP_BLOB_DOWNLOAD_MAX_RETRIES) {
    const { blobServiceClient } = getAzureClient();
    const containerClient = blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const downloadBlockBlobResponse = await blockBlobClient.download(0, undefined, {
      maxRetryRequests,
    });
    return downloadBlockBlobResponse.readableStreamBody;
  }
}
