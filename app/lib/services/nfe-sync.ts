import connectDB from '@/app/lib/connect-db';
import { parseNfeEvent } from '@/app/lib/nfe-event';
import { parseNfeSummaryXml } from '@/app/lib/nfe-xml';
import { PermanentJobError } from '@/app/lib/jobs/errors';
import { appendJobLog } from '@/app/lib/jobs/log';
import { logger } from '@/app/lib/logger';
import { toObjectId } from '@/app/lib/mongo-id';
import { INITIAL_NSU, SefazBlockedError } from '@/app/lib/sefaz-client';
import {
  SEFAZ_BATCH_SIZE,
  fetchSefazBatch,
  isSimulatedSource,
  type SefazBatch,
} from '@/app/lib/sefaz-source';
import type { NfeSyncProgress } from '@/app/lib/types/jobs';
import { applyInvoiceCancellation } from '@/app/lib/services/nfe-cancellation';
import { captureOneFile, type NfeCaptureFileResult } from '@/app/lib/services/nfe-capture';
import { recordNfeSummary } from '@/app/lib/services/nfe-documents';
import { reserveSefazRequest, settleSefazRequest } from '@/app/lib/services/sefaz-requests';
import { nextPollAt, SEFAZ_POLL_DEFAULT_MINUTES } from '@/app/lib/sefaz-sync-gate';
import { evaluateStoreGate, getSefazResumeAt } from '@/app/lib/services/sefaz-store-gate';
import JobsDB from '@/app/models/jobs';
import StoreDB from '@/app/models/stores';

/** Batches one run may pull. Real SEFAZ allows 20 calls/h per CNPJ; a run that
 * stops after 3 can never spend that budget on its own — the resume cron (or the
 * next press, past the cooldown) continues from the saved cursor. */
export const MAX_BATCHES_PER_RUN = 3;

export type NfeSyncSummary = {
  files: NfeCaptureFileResult[];
  progress: NfeSyncProgress;
};

// Everything one run threads through its steps: identity, the counters that are
// mirrored to the job document, and the per-invoice outcomes.
type RunState = {
  storeId: string;
  jobId: string;
  progress: NfeSyncProgress;
  files: NfeCaptureFileResult[];
  flush: () => Promise<unknown>;
  step: (name: string, message: string) => Promise<void>;
};

const isProcNfe = (schema: string) => schema.startsWith('procNFe');
const isSummary = (schema: string) => schema.startsWith('resNFe');
const isEvent = (schema: string) =>
  schema.startsWith('resEvento') || schema.startsWith('procEventoNFe');
const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const bump = (progress: NfeSyncProgress, key: keyof NfeSyncProgress, by = 1) => {
  (progress as Record<string, unknown>)[key] = ((progress[key] as number | undefined) ?? 0) + by;
};

function createRunState(storeId: string, jobId: string): RunState {
  const log = logger.child({ correlationId: jobId, storeId, job: 'sefaz.nfe.received' });
  const progress: NfeSyncProgress = {
    phase: 'fetching',
    docsDone: 0,
    invoicesProcessed: 0,
    invoicesDuplicate: 0,
    invoicesFailed: 0,
    invoicesCancelled: 0,
    cancelledValue: 0,
    docsIgnored: 0,
    summariesRecorded: 0,
    itemsMatched: 0,
    itemsDrafted: 0,
    batchesDone: 0,
    batchesMax: MAX_BATCHES_PER_RUN,
  };
  return {
    storeId,
    jobId,
    progress,
    files: [],
    flush: () =>
      JobsDB.updateOne(
        { _id: jobId },
        { $set: { 'progress.nfe': progress, 'progress.phase': progress.phase } },
      ),
    step: async (name, message) => {
      log.info({ step: name }, message);
      await appendJobLog(jobId, { step: name, message });
    },
  };
}

/** One source call, with its bookkeeping. A SEFAZ block ends the job for good. */
async function fetchBatch(state: RunState, cursor: string, batchNumber: number) {
  const { storeId, progress } = state;
  progress.phase = 'fetching';
  await state.flush();

  // Booked before the call so a worker that dies mid-call still leaves the query
  // counted against the hourly ceiling.
  const requestId = await reserveSefazRequest({
    storeId,
    tpAmb: 1,
    simulated: isSimulatedSource(),
  });

  let batch: SefazBatch;
  try {
    batch = await fetchSefazBatch({ ultNSU: cursor });
  } catch (err) {
    if (!(err instanceof SefazBlockedError)) {
      // SEFAZ may or may not have seen it: the row stays and keeps counting.
      await settleSefazRequest(requestId, {
        cStat: 'error',
        xMotivo: err instanceof Error ? err.message : 'unknown error',
        documentsCount: 0,
      });
      throw err;
    }
    progress.phase = 'blocked';
    await state.flush();
    await settleSefazRequest(requestId, {
      cStat: '656',
      documentsCount: 0,
      blockedUntil: err.blockedUntil,
    });
    await state.step(
      'sefaz-blocked',
      `A SEFAZ bloqueou este CNPJ até ${err.blockedUntil.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    );
    throw new PermanentJobError(err.message, 'sefaz_blocked');
  }

  progress.source = batch.simulated ? 'simulated' : 'live';
  progress.maxNsu = batch.maxNSU;
  progress.batchesDone = batchNumber;
  await settleSefazRequest(requestId, {
    cStat: batch.cStat,
    xMotivo: batch.xMotivo,
    ultNSU: batch.ultNSU,
    maxNSU: batch.maxNSU,
    documentsCount: batch.documents.length,
    simulated: batch.simulated,
  });
  await state.step(
    'sefaz-fetch',
    `Lote ${batchNumber}/${MAX_BATCHES_PER_RUN}: cStat ${batch.cStat}, ${batch.documents.length} documento(s)${batch.simulated ? ' (fonte simulada)' : ''}.`,
  );
  return batch;
}

/**
 * An event document. Only a cancellation matters: it gives back the stock of an
 * invoice already captured, or is remembered for one not captured yet. Anything
 * else (correction letter, recipient manifestation) is just counted. A database
 * failure is NOT swallowed: the batch cursor must not move past a cancellation
 * that was not applied. Applying one twice is safe (idempotent per line).
 */
async function processEvent(state: RunState, doc: SefazBatch['documents'][number]) {
  const { progress } = state;
  let event: ReturnType<typeof parseNfeEvent>;
  try {
    event = parseNfeEvent(doc.xml);
  } catch (err) {
    bump(progress, 'docsIgnored');
    await state.step(
      'nfe-error',
      `NSU ${doc.nsu}: ${err instanceof Error ? err.message : 'evento ilegível'}.`,
    );
    return;
  }
  if (!event?.isCancellation) {
    bump(progress, 'docsIgnored');
    return;
  }

  const outcome = await applyInvoiceCancellation(state.storeId, event.accessKey, {
    cancelledAt: event.occurredAt ?? new Date(),
    nsu: doc.nsu,
  });
  if (outcome.status === 'reversed') {
    bump(progress, 'invoicesCancelled');
    bump(progress, 'cancelledValue', outcome.reversedValue);
    await state.step(
      'nfe-cancelled',
      `NSU ${doc.nsu}: NF-e ${event.accessKey} cancelada — ${brl(outcome.reversedValue)} estornados do estoque em ${outcome.lines} linha(s).`,
    );
  } else if (outcome.status === 'marked') {
    bump(progress, 'invoicesCancelled');
    await state.step(
      'nfe-cancelled',
      `NSU ${doc.nsu}: NF-e ${event.accessKey} cancelada; não havia estoque a estornar.`,
    );
  } else if (outcome.status === 'recorded') {
    bump(progress, 'docsIgnored');
    await state.step(
      'nfe-cancelled',
      `NSU ${doc.nsu}: cancelamento da NF-e ${event.accessKey}, ainda não capturada, registrado para quando ela chegar.`,
    );
  } else {
    bump(progress, 'docsIgnored');
  }
}

/** A preview (resNFe): no items to apply, but the note exists — it is kept for the Notas screen so
 * "announced, not read yet" is visible. A database failure is NOT swallowed (the cursor must not
 * move past a note that was not remembered); an unreadable summary is only logged and counted. */
async function processSummary(state: RunState, doc: SefazBatch['documents'][number]) {
  let summary: ReturnType<typeof parseNfeSummaryXml>;
  try {
    summary = parseNfeSummaryXml(doc.xml);
  } catch (err) {
    bump(state.progress, 'docsIgnored');
    await state.step(
      'nfe-error',
      `NSU ${doc.nsu}: ${err instanceof Error ? err.message : 'resumo ilegível'}.`,
    );
    return;
  }
  await recordNfeSummary(state.storeId, summary, { nsu: doc.nsu });
  bump(state.progress, 'summariesRecorded');
}

/** One document: a full NFe goes through the manual-upload capture path; an
 * event is handled by `processEvent`; a summary (resNFe) has no items to capture
 * and is only counted. */
async function processDocument(state: RunState, doc: SefazBatch['documents'][number]) {
  const { progress } = state;
  if (isEvent(doc.schema)) {
    await processEvent(state, doc);
    return;
  }
  if (isSummary(doc.schema)) {
    await processSummary(state, doc);
    return;
  }
  if (!isProcNfe(doc.schema)) {
    bump(progress, 'docsIgnored');
    return;
  }

  const result = await captureOneFile(
    state.storeId,
    { fileName: `NSU-${doc.nsu}.xml`, content: doc.xml },
    { source: 'sefaz', nsu: doc.nsu },
  );
  state.files.push(result);

  if (result.status === 'processed') {
    bump(progress, 'invoicesProcessed');
    bump(progress, 'itemsMatched', result.itemsMatched);
    bump(progress, 'itemsDrafted', result.itemsDrafted);
  } else if (result.status === 'duplicate') {
    bump(progress, 'invoicesDuplicate');
  } else if (result.status === 'cancelled') {
    bump(progress, 'invoicesCancelled');
  } else {
    bump(progress, 'invoicesFailed');
    await state.step(
      'nfe-error',
      `NSU ${doc.nsu}: ${result.error ?? 'não foi possível processar'}.`,
    );
  }
}

async function processBatch(state: RunState, batch: SefazBatch, baseline: number) {
  const { progress } = state;
  const pendingNsus = Number(batch.maxNSU ?? batch.ultNSU) - baseline;
  progress.docsTotal = Math.min(pendingNsus, MAX_BATCHES_PER_RUN * SEFAZ_BATCH_SIZE);
  progress.phase = 'processing';
  await state.flush();

  for (const doc of batch.documents) {
    await processDocument(state, doc);
    bump(progress, 'docsDone');
    await state.flush();
  }
}

/** Saves the cursor after a batch and says whether another batch should follow. */
async function advanceCursor(
  state: RunState,
  batch: SefazBatch,
  cursor: string,
  batchNumber: number,
): Promise<boolean> {
  state.progress.ultNsu = cursor;
  await StoreDB.updateOne({ _id: toObjectId(state.storeId) }, { $set: { sefazUltNsu: cursor } });
  await state.step('cursor-saved', `Lote ${batchNumber} concluído; cursor salvo no NSU ${cursor}.`);

  const moreWaiting =
    batch.documents.length >= SEFAZ_BATCH_SIZE && cursor < (batch.maxNSU ?? cursor);
  if (moreWaiting && batchNumber === MAX_BATCHES_PER_RUN) {
    await state.step(
      'batch-cap',
      'Ainda há documentos aguardando; a próxima busca continua a partir do cursor salvo.',
    );
  }
  return moreWaiting;
}

/**
 * Checked before EVERY batch, not only at the click: a run that started with room
 * can use it up halfway. Pausing is a clean end, not a failure, so Bull never
 * retries it (a retry would only spend the quota that ran out). The cooldown is
 * ignored because the claim that started this run stamped it.
 */
async function pauseForQuota(state: RunState): Promise<boolean> {
  const quota = await evaluateStoreGate(state.storeId, new Date(), { ignoreCooldown: true });
  if (!quota || quota.gate.allowed) return false;
  await state.step(
    'quota-paused',
    quota.gate.reason === 'blocked'
      ? 'A SEFAZ tem este CNPJ bloqueado; a busca será retomada quando liberar.'
      : 'Cota horária da SEFAZ quase esgotada; a busca será retomada quando liberar.',
  );
  return true;
}

type PollSettings = { enabled: boolean; intervalMinutes: number };

const formatBrt = (date: Date) => date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Leaves the store ready for the cron (the one that resumes and polls):
 *  - a backlog is continued as soon as the gate allows (cooldown/quota/block,
 *    whichever lasts longest), whether or not polling is on;
 *  - with nothing left, a store with polling on is checked again one interval
 *    from now (never before the gate reopens); otherwise nothing is scheduled.
 */
async function scheduleNextRun(state: RunState, backlog: boolean, poll: PollSettings) {
  const { storeId, progress } = state;
  const filter = { _id: toObjectId(storeId) };
  const clearError = { sefazLastError: '', sefazLastErrorAt: '' };

  if (backlog) {
    const resumeAt = await getSefazResumeAt(storeId);
    progress.resumeAt = resumeAt.toISOString();
    progress.resumeKind = 'backlog';
    await StoreDB.updateOne(filter, {
      $set: {
        sefazResumeAt: resumeAt,
        sefazBacklog: true,
        ...(progress.maxNsu ? { sefazBacklogMaxNsu: progress.maxNsu } : {}),
      },
      $unset: clearError,
    });
    await state.step(
      'resume-scheduled',
      `Ainda há documentos na SEFAZ; a busca continua automaticamente a partir de ${formatBrt(resumeAt)}.`,
    );
    return;
  }

  if (!poll.enabled) {
    await StoreDB.updateOne(filter, {
      $set: { sefazBacklog: false },
      $unset: { sefazResumeAt: '', sefazBacklogMaxNsu: '', ...clearError },
    });
    return;
  }

  const now = new Date();
  const next = nextPollAt(now, poll.intervalMinutes, await getSefazResumeAt(storeId, now));
  progress.resumeAt = next.toISOString();
  progress.resumeKind = 'poll';
  await StoreDB.updateOne(filter, {
    $set: { sefazResumeAt: next, sefazBacklog: false },
    $unset: { sefazBacklogMaxNsu: '', ...clearError },
  });
  await state.step('poll-scheduled', `Próxima verificação automática: ${formatBrt(next)}.`);
}

/**
 * A run that died. The reason is kept on the store for the Crons screen. A store
 * with polling on is still checked again at its normal pace (one query per
 * interval, a small fraction of the hourly quota); without polling nothing is
 * rescheduled, so a failure that persists (a revoked certificate) is never
 * retried on its own faster than a person would notice it.
 */
async function recordRunFailure(storeId: string, err: unknown, poll: PollSettings) {
  const now = new Date();
  const message = (err instanceof Error ? err.message : 'unknown error').slice(0, 500);
  const set: Record<string, unknown> = { sefazLastError: message, sefazLastErrorAt: now };
  if (poll.enabled) {
    set.sefazResumeAt = nextPollAt(now, poll.intervalMinutes, await getSefazResumeAt(storeId, now));
  }
  await StoreDB.updateOne({ _id: toObjectId(storeId) }, { $set: set });
}

/**
 * The batch loop. `backlog` is true while documents are still waiting on SEFAZ
 * when it stops — either it paused for the quota or it spent its per-run batches
 * on a full last one.
 */
async function pullBatches(
  state: RunState,
  startCursor: string,
): Promise<{ paused: boolean; backlog: boolean }> {
  let cursor = startCursor;
  // First NSU that can actually hold a document: NSUs before the first delivered
  // one are empty, not "work left", so they must not inflate the denominator.
  let baseline = Number(cursor);
  let backlog = false;

  for (let batchNumber = 1; batchNumber <= MAX_BATCHES_PER_RUN; batchNumber += 1) {
    if (await pauseForQuota(state)) return { paused: true, backlog: true };

    const batch = await fetchBatch(state, cursor, batchNumber);
    const first = batch.documents[0];
    if (!first) break; // 137 — nothing new, the sequence is exhausted.

    if (batchNumber === 1) baseline = Math.max(baseline, Number(first.nsu) - 1);
    await processBatch(state, batch, baseline);

    cursor = batch.ultNSU ?? cursor;
    backlog = await advanceCursor(state, batch, cursor, batchNumber);
    if (!backlog) break;
  }
  return { paused: false, backlog };
}

/**
 * "Buscar na SEFAZ": pulls document batches from the configured source
 * (simulated today), captures every full NFe through the same path a manual XML
 * upload takes (idempotent per access key, Tier 1 + 2), and keeps the job's
 * `progress.nfe` + `logs[]` current while it goes. The NSU cursor is saved after
 * each batch, so a run that dies halfway resumes instead of starting over.
 */
export async function syncNfeFromSefaz(
  storeId: string,
  context: { jobId: string },
): Promise<NfeSyncSummary> {
  await connectDB();
  const store = await StoreDB.findById(toObjectId(storeId))
    .select('name sefazUltNsu sefazPollEnabled sefazPollIntervalMinutes')
    .lean<{
      name: string;
      sefazUltNsu?: string;
      sefazPollEnabled?: boolean;
      sefazPollIntervalMinutes?: number;
    } | null>();
  if (!store) throw new PermanentJobError('Store not found.', 'store_not_found');

  const state = createRunState(storeId, context.jobId);
  const cursor = store.sefazUltNsu || INITIAL_NSU;

  await state.flush();
  await state.step('sync-start', `Busca iniciada para "${store.name}" a partir do NSU ${cursor}.`);

  const poll: PollSettings = {
    enabled: store.sefazPollEnabled === true,
    intervalMinutes: store.sefazPollIntervalMinutes ?? SEFAZ_POLL_DEFAULT_MINUTES,
  };

  let run: { paused: boolean; backlog: boolean };
  try {
    run = await pullBatches(state, cursor);
  } catch (err) {
    await recordRunFailure(storeId, err, poll);
    throw err;
  }

  const { progress } = state;
  progress.phase = run.paused ? 'paused' : 'done';
  await scheduleNextRun(state, run.backlog, poll);
  await state.flush();
  await state.step(
    'sync-done',
    `Busca concluída: ${progress.invoicesProcessed} nota(s) capturada(s), ${progress.invoicesDuplicate} já conhecida(s), ${progress.invoicesFailed} com falha, ${progress.invoicesCancelled} cancelada(s), ${progress.summariesRecorded ?? 0} prévia(s) guardada(s), ${progress.docsIgnored} evento(s)/outro(s) ignorado(s) · ${progress.itemsMatched} item(ns) mapeado(s), ${progress.itemsDrafted} rascunho(s).`,
  );

  return { files: state.files, progress };
}
