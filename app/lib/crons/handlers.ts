import { env } from '@/app/lib/env';
import { getJobQueue } from '@/app/lib/bull/queue';
import { CronKey } from '@/app/lib/crons/definitions';
import type { CronHandlers } from '@/app/lib/services/crons';
import { pullBridgeEvents } from '@/app/lib/services/bridge-pull';
import { purgeOldCronRunRecords } from '@/app/lib/services/cron-job-records';
import { resumePendingSefazSyncs } from '@/app/lib/services/nfe-sync-resume';

// The code behind each cron in definitions.ts. Worker only: it reaches the queue.
// Each handler returns the one line the Crons screen shows as "last result".

const DAY_MS = 24 * 60 * 60 * 1000;
const CRON_RUN_HISTORY_DAYS = 14;

export const cronHandlers: CronHandlers = {
  [CronKey.SEFAZ_AUTO_SYNC]: async () => {
    const s = await resumePendingSefazSyncs();
    return {
      summary: `${s.resumed} iniciada(s), ${s.deferred} adiada(s), ${s.skipped} em andamento, ${s.failed} com falha`,
      // Nothing started, postponed or failed: the tick found no work (stores already syncing don't count).
      idle: s.resumed === 0 && s.deferred === 0 && s.failed === 0,
    };
  },
  [CronKey.QUEUE_CLEANUP]: async () => {
    const removed = await getJobQueue().clean(env.APP_BULL_FAILED_JOB_TTL_DAYS * DAY_MS, 'failed');
    // The history of cron runs (Sistema > Jobs) is kept for a while, not forever.
    const oldRuns = await purgeOldCronRunRecords(CRON_RUN_HISTORY_DAYS);
    return {
      summary: `${removed.length} job(s) com falha removido(s), ${oldRuns} execução(ões) antiga(s) de cron removida(s)`,
      idle: removed.length === 0 && oldRuns === 0,
    };
  },
  [CronKey.BRIDGE_PULL]: async () => {
    const r = await pullBridgeEvents();
    if (!r.configured) return { summary: 'ponte não configurada (BRIDGE_MONGODB_URI)', idle: true };
    return {
      summary: `${r.recorded} evento(s) trazido(s), ${r.duplicate} repetido(s), ${r.ignored} ignorado(s), ${r.noStore} sem loja, ${r.errors} com erro`,
      idle: r.fetched === 0,
    };
  },
};
