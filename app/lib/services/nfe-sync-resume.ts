import connectDB from '@/app/lib/connect-db';
import { TooManyRequestsError } from '@/app/lib/errors';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { logger } from '@/app/lib/logger';
import { SEFAZ_SYNC_JOB_CONFIG, claimSefazSync } from '@/app/lib/services/nfe-sync-claim';
import { getSefazResumeAt } from '@/app/lib/services/sefaz-store-gate';
import JobsDB from '@/app/models/jobs';
import StoreDB from '@/app/models/stores';

/** Stores resumed per tick — a bound, not a target; the rest wait for the next. */
const MAX_STORES_PER_TICK = 50;

/** `requestedByUserId` for runs nobody clicked. */
export const SEFAZ_RESUME_REQUESTER = 'system:sefaz-resume';

export type SefazResumeSummary = {
  resumed: number;
  deferred: number;
  skipped: number;
  failed: number;
};

/**
 * Continues "Buscar na SEFAZ" runs that stopped with documents still waiting
 * (`Store.sefazResumeAt`, set by `syncNfeFromSefaz`). Meant to be called on a
 * timer by the worker; it does not need to know why a run stopped, because the
 * NSU cursor is already saved and the same claim the button uses decides whether
 * SEFAZ may be called now — a store whose quota or cooldown has not reopened is
 * just pushed to when it will.
 *
 * `sefazResumeAt` is cleared only after the next job is enqueued, and a run that
 * dies leaves it cleared: a failure that persists (a revoked certificate) must not
 * be retried every hour by the cron, spending the quota each time.
 */
export async function resumePendingSefazSyncs(now: Date = new Date()): Promise<SefazResumeSummary> {
  await connectDB();
  const summary: SefazResumeSummary = { resumed: 0, deferred: 0, skipped: 0, failed: 0 };
  const log = logger.child({ component: 'sefaz-resume' });

  const due = await StoreDB.find({ sefazResumeAt: { $lte: now } })
    .select('_id organizationId')
    .limit(MAX_STORES_PER_TICK)
    .lean<Array<{ _id: unknown; organizationId: unknown }>>();

  for (const store of due) {
    const storeId = String(store._id);
    try {
      const running = await JobsDB.exists({
        kind: 'sefaz.nfe.received',
        'payload.storeId': storeId,
        status: { $in: ['queued', 'running'] },
      });
      if (running) {
        summary.skipped += 1;
        continue;
      }

      try {
        await claimSefazSync(storeId, now);
      } catch (err) {
        if (!(err instanceof TooManyRequestsError)) throw err;
        const resumeAt = await getSefazResumeAt(storeId, now);
        await StoreDB.updateOne({ _id: store._id }, { $set: { sefazResumeAt: resumeAt } });
        summary.deferred += 1;
        continue;
      }

      await createAndEnqueueJob(
        {
          kind: 'sefaz.nfe.received',
          organizationId: String(store.organizationId),
          reference: `NFE-SYNC-${storeId}-${now.getTime()}`,
          type: 'AdHoc',
          config: SEFAZ_SYNC_JOB_CONFIG,
          payload: { requestedByUserId: SEFAZ_RESUME_REQUESTER, storeId, mode: 'sefaz' },
        },
        log,
      );
      // Conditional: a job that finished while we were enqueueing may already
      // have set a later `sefazResumeAt`, which must stay.
      await StoreDB.updateOne(
        { _id: store._id, sefazResumeAt: { $lte: now } },
        { $unset: { sefazResumeAt: '' } },
      );
      summary.resumed += 1;
      log.info({ storeId }, 'resumed a paused SEFAZ sync');
    } catch (err) {
      summary.failed += 1;
      log.error({ err, storeId }, 'could not resume a paused SEFAZ sync');
    }
  }
  return summary;
}
