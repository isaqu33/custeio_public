import { auth } from '@/app/lib/auth';
import { AppFeature } from '@/app/lib/features';
import { AzuriteBlobAdapter } from '@/app/lib/azure-blob-storage';
import { env } from '@/app/lib/env';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { fail } from '@/app/lib/api-response';
import { withObservability } from '@/app/lib/observability';
import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';

const PUBLIC_ASSET_PREFIXES = ['system/'];

function isSafeBlobPath(blobPath: string) {
  return (
    blobPath.length > 0 &&
    !blobPath.startsWith('/') &&
    blobPath.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function contentTypeForPath(blobPath: string) {
  const lower = blobPath.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

type RouteContext = { params: Promise<{ blobPath: string[] }> };

export const GET = withObservability<RouteContext>(AppFeature.ASSETS_GET, async (_req, ctx) => {
  const { params } = ctx;
  const { blobPath: parts } = await params;
  const blobPath = parts.map(decodeURIComponent).join('/');
  if (!isSafeBlobPath(blobPath)) {
    return fail(ApiErrorCode.INVALID_INPUT, HttpStatus.BAD_REQUEST);
  }

  const isPublicAsset = PUBLIC_ASSET_PREFIXES.some((prefix) => blobPath.startsWith(prefix));
  if (!isPublicAsset && !(await auth())) {
    return fail(ApiErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
  }

  const adapter = new AzuriteBlobAdapter(env.APP_SYSTEM_ASSETS_CONTAINER);
  const nodeStream = await adapter.downloadFile(blobPath).catch(() => null);
  if (!nodeStream) {
    return fail(ApiErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
  }

  return new NextResponse(Readable.toWeb(nodeStream as Readable) as ReadableStream, {
    headers: {
      'Content-Type': contentTypeForPath(blobPath),
      'Cache-Control': isPublicAsset ? 'public, max-age=300' : 'no-store',
    },
  });
});
