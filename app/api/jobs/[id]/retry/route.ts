import { AppFeature } from '@/app/lib/features';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { enqueueJobById } from '@/app/lib/bull/queue';
import connectDB from '@/app/lib/connect-db';
import { BadRequestError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import JobsDB from '@/app/models/jobs';
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/app/lib/services/audit-events';

type RouteContext = { params: Promise<{ id: string }> };

type JobLean = {
  _id: mongoose.Types.ObjectId;
  status?: string;
  organizationId?: mongoose.Types.ObjectId;
  config?: { attempts?: number; backoff?: { type?: 'fixed' | 'exponential'; delay?: number } };
};

// Support action: re-run a job from where it stopped. The analysis worker resumes
// on its own — conversion-skip avoids re-converting and the per-batch checkpoint
// avoids re-spending tokens — so this just resets status and re-enqueues.
export const POST = withObservability<RouteContext>(
  AppFeature.JOBS_RETRY,
  async (_req, ctx, { log }) => {
    const session = await requireAuth();
    // The Jobs page lives under /system, which is System/Support only.
    // Repeated here because the layout guard shapes the UI and this shapes
    // the request.
    await requireSystemAccess(session);
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) throw new BadRequestError('Invalid job id.');

    await connectDB();
    const job = await JobsDB.findById(id).lean<JobLean | null>();
    if (!job) throw new NotFoundError('Job not found.');
    await requireOrganizationAccess(session, String(job.organizationId));

    // Only terminal jobs can be retried; an in-flight job would double-process.
    if (!['failed', 'canceled', 'done'].includes(job.status ?? '')) {
      throw new BadRequestError('Job is still in progress and cannot be retried.');
    }

    await JobsDB.updateOne(
      { _id: job._id },
      {
        $set: { status: 'queued' },
        $push: {
          logs: {
            jobStatus: 'queued',
            message: 'Re-enqueued by support (resume from last checkpoint)',
            step: 'retry',
            timestamp: new Date(),
          },
        },
      },
    );

    const queueJob = await enqueueJobById({ jobId: String(job._id) }, job.config, log);
    await JobsDB.updateOne({ _id: job._id }, { $set: { 'queue.queueJobId': String(queueJob.id) } });

    await logAuditEvent({
      organizationId: String(job.organizationId),
      actorUserId: session.user?.id,
      action: 'job.retry',
      resourceType: 'job',
      resourceId: String(job._id),
      source: 'ui',
    });

    return NextResponse.json(
      { done: true, message: 'Job re-enqueued.', data: { jobId: String(job._id) } },
      { status: HttpStatus.OK },
    );
  },
);
