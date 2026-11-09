import { AppFeature } from '@/app/lib/features';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { SYSTEM_ONLY_JOB_KINDS } from '@/app/lib/jobs/system-only-kinds';
import { AzuriteBlobAdapter } from '@/app/lib/azure-blob-storage';
import connectDB from '@/app/lib/connect-db';
import { BadRequestError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import JobsDB from '@/app/models/jobs';
import mongoose from 'mongoose';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

type ExportResult = {
  container?: string;
  blobPath?: string;
  fileName?: string;
  mimeType?: string;
};

type JobLean = {
  _id: mongoose.Types.ObjectId;
  kind?: string;
  status?: string;
  organizationId?: mongoose.Types.ObjectId;
  result?: ExportResult;
};

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withObservability<RouteContext>(AppFeature.JOBS_DOWNLOAD, async (_req, ctx) => {
  const session = await requireAuth();
  // Not a group permission: every downloadable kind below is a platform report,
  // so there is nothing here a clinic could legitimately be granted.
  await requireSystemAccess(session);
  const { id } = await ctx.params;

  if (!mongoose.isValidObjectId(id)) {
    throw new BadRequestError('Invalid job id.');
  }

  await connectDB();

  const job = await JobsDB.findById(id).lean<JobLean | null>();
  if (!job) {
    throw new NotFoundError('Job not found.');
  }

  await requireOrganizationAccess(session, String(job.organizationId));

  // Every kind whose result is a CSV — which is exactly the system-only set.
  // Sharing the constant keeps "who may download" and "what is hidden from a
  // tenant" from drifting apart.
  if (!SYSTEM_ONLY_JOB_KINDS.includes(String(job.kind))) {
    throw new BadRequestError('Job is not a downloadable export.');
  }
  if (job.status !== 'done') {
    throw new BadRequestError('Export is not ready yet.');
  }

  const { container, blobPath, fileName } = job.result ?? {};
  if (!container || !blobPath) {
    throw new NotFoundError('Export file is missing.');
  }

  const adapter = new AzuriteBlobAdapter(container);
  const nodeStream = await adapter.downloadFile(blobPath);
  if (!nodeStream) {
    throw new NotFoundError('Export file is missing.');
  }

  // Blob is stored gzipped to save space; pipe through gunzip so the user
  // downloads a plain .csv that opens directly in spreadsheets.
  const isGzipped = blobPath.endsWith('.csv.gz');
  const decoded = isGzipped
    ? (nodeStream as Readable).pipe(zlib.createGunzip())
    : (nodeStream as Readable);

  await logAuditEvent({
    organizationId: String(job.organizationId),
    actorUserId: session.user?.id,
    action: 'job.export_download',
    resourceType: 'job',
    resourceId: id,
    source: 'ui',
  });

  const downloadName = (fileName || `${id}.csv.gz`).replace(/\.gz$/i, '');
  return new NextResponse(Readable.toWeb(decoded) as ReadableStream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Cache-Control': 'no-store',
    },
  });
});
