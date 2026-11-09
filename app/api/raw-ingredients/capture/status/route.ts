import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { nfeSyncForecast, type NfeSyncForecast } from '@/app/lib/jobs/nfe-sync-estimate';
import {
  getSefazSyncAvailability,
  type SefazSyncAvailability,
} from '@/app/lib/services/nfe-sync-claim';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import type { NfeSyncProgress } from '@/app/lib/types/jobs';
import { captureNfeStatus } from '@/app/lib/validations';
import JobsDB from '@/app/models/jobs';

type CaptureStatusResponse = {
  // A store only ever has one capture running at a time in practice (the UI
  // disables the button while one is in flight), but this answers "is there
  // one at all" rather than assuming that.
  inProgress: boolean;
  // Live numbers of the running SEFAZ search (absent for a manual upload, which
  // has no progress counters).
  running?: {
    progress: NfeSyncProgress;
    forecast: NfeSyncForecast;
  };
  // Whether "Buscar na SEFAZ" may be pressed, and when it may be again.
  sync: SefazSyncAvailability;
  lastCompleted?: {
    status: 'done' | 'failed';
    finishedAt?: string;
    totalFiles?: number;
    filesProcessed?: number;
    totalItemsMatched?: number;
    totalItemsDrafted?: number;
  };
};

type RunningJobLean = {
  status: 'queued' | 'running';
  progress?: { nfe?: NfeSyncProgress; timings?: { startedAt?: Date } };
};

function runningSnapshot(job: RunningJobLean): CaptureStatusResponse['running'] {
  const nfe = job.progress?.nfe;
  if (!nfe) return undefined;
  return {
    progress: nfe,
    forecast: nfeSyncForecast({
      status: job.status,
      progress: nfe,
      startedAt: job.progress?.timings?.startedAt,
      now: Date.now(),
    }),
  };
}

async function lastCompletedCapture(
  storeId: string,
): Promise<CaptureStatusResponse['lastCompleted']> {
  const lastJob = await JobsDB.findOne({
    kind: 'sefaz.nfe.received',
    'payload.storeId': storeId,
    status: { $in: ['done', 'failed'] },
  })
    .select('status result progress.timings.finishedAt')
    .sort({ createdAt: -1 })
    .lean<{
      status: 'done' | 'failed';
      result?: {
        totalFiles?: number;
        filesProcessed?: number;
        totalItemsMatched?: number;
        totalItemsDrafted?: number;
      };
      progress?: { timings?: { finishedAt?: Date } };
    } | null>();
  if (!lastJob) return undefined;

  return {
    status: lastJob.status,
    finishedAt: lastJob.progress?.timings?.finishedAt?.toISOString(),
    totalFiles: lastJob.result?.totalFiles,
    filesProcessed: lastJob.result?.filesProcessed,
    totalItemsMatched: lastJob.result?.totalItemsMatched,
    totalItemsDrafted: lastJob.result?.totalItemsDrafted,
  };
}

/**
 * Polled by the Stock page while a capture is running, to know when to stop
 * showing the loading skeleton and refresh the table. Tenant-facing — same
 * storeId → organization resolution as every other raw-ingredients route.
 */
async function handler(req: Request) {
  const session = await requireAuth();
  const { storeId } = await parseRouteInput(req, captureNfeStatus);

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const inProgressJob = await JobsDB.findOne({
    kind: 'sefaz.nfe.received',
    'payload.storeId': storeId,
    status: { $in: ['queued', 'running'] },
  })
    .select('status progress.nfe progress.timings.startedAt')
    .lean<RunningJobLean | null>();

  const response: CaptureStatusResponse = {
    inProgress: Boolean(inProgressJob),
    sync: await getSefazSyncAvailability(storeId),
    running: inProgressJob ? runningSnapshot(inProgressJob) : undefined,
    lastCompleted: inProgressJob ? undefined : await lastCompletedCapture(storeId),
  };

  return NextResponse.json({ done: true, data: response }, { status: HttpStatus.OK });
}

export const GET = withObservability<{}>(AppFeature.RAW_INGREDIENTS_CAPTURE_NFE_STATUS, handler);
export const POST = withObservability<{}>(AppFeature.RAW_INGREDIENTS_CAPTURE_NFE_STATUS, handler);
