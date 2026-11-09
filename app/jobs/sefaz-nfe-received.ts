import type { JobExecutionContext, JobPayloadByKind } from '@/app/lib/jobs/types';
import { requestIngredientsReviewAfterCapture } from '@/app/lib/services/ingredient-review-trigger';
import { captureNfeFilesForStore } from '@/app/lib/services/nfe-capture';
import { syncNfeFromSefaz } from '@/app/lib/services/nfe-sync';

// The per-file list is stored on the Job document, which Mongo caps at 16 MB.
// Today a run is ~150 notes, but the list must not grow with the batch budget:
// failures come first (they are what the owner has to act on), then the rest.
export const MAX_RESULT_FILES = 200;

function capResultFiles<T extends { status: string }>(files: T[]): T[] {
  if (files.length <= MAX_RESULT_FILES) return files;
  const failed = files.filter((f) => f.status === 'error');
  const others = files.filter((f) => f.status !== 'error');
  return [...failed, ...others].slice(0, MAX_RESULT_FILES);
}

/**
 * Two ways in, one capture path (docs/features/sefaz-nfe.md):
 *
 * - `upload`: the owner sent NFe XML files.
 * - `sefaz`: "Buscar na SEFAZ" — the job pulls document batches itself (today
 *   from the simulated source, see app/lib/sefaz-source.ts) and reports live
 *   progress in `progress.nfe` + `logs[]`.
 *
 * Both parse each NFe the same way and apply Tier 1 (auto-draft an unmapped
 * line) + Tier 2 (dedupe by name) from `captureNfeFilesForStore`, and both
 * return a per-file outcome so the job detail view shows real results.
 */
export async function sefazNfeReceivedJob(
  payload: JobPayloadByKind['sefaz.nfe.received'],
  context: JobExecutionContext,
): Promise<Record<string, unknown>> {
  if (payload.mode === 'sefaz') {
    const { files, progress } = await syncNfeFromSefaz(payload.storeId, { jobId: context.jobId });
    const paused = progress.phase === 'paused';
    // New drafts are reviewed by the AI right away (operation, families, safe merges).
    if ((progress.itemsDrafted ?? 0) > 0)
      await requestIngredientsReviewAfterCapture(payload.storeId);
    return {
      kind: 'sefaz.nfe.received',
      mode: 'sefaz',
      storeId: payload.storeId,
      attempt: context.attempt,
      totalFiles: files.length,
      filesProcessed: files.filter((f) => f.status !== 'error').length,
      filesFailed: files.filter((f) => f.status === 'error').length,
      // A pause is a clean end with work left, so it must not read as 100%.
      percentComplete:
        paused && progress.docsTotal
          ? Math.round(((progress.docsDone ?? 0) / progress.docsTotal) * 100)
          : 100,
      paused,
      // Set when documents are still waiting; the resume cron continues from here.
      resumeAt: progress.resumeAt,
      resumeKind: progress.resumeKind,
      invoicesCancelled: progress.invoicesCancelled ?? 0,
      cancelledValue: progress.cancelledValue ?? 0,
      totalItemsMatched: progress.itemsMatched ?? 0,
      totalItemsDrafted: progress.itemsDrafted ?? 0,
      docsIgnored: progress.docsIgnored ?? 0,
      batchesDone: progress.batchesDone ?? 0,
      ultNsu: progress.ultNsu,
      source: progress.source,
      filesOmitted: Math.max(0, files.length - MAX_RESULT_FILES),
      files: capResultFiles(files),
      completedAt: new Date().toISOString(),
    };
  }

  const summary = await captureNfeFilesForStore(payload.storeId, payload.files ?? []);

  if (summary.totalItemsDrafted > 0) await requestIngredientsReviewAfterCapture(payload.storeId);

  const filesProcessed = summary.files.filter((f) => f.status !== 'error').length;
  const filesFailed = summary.files.filter((f) => f.status === 'error').length;
  const totalFiles = summary.files.length;

  return {
    kind: 'sefaz.nfe.received',
    mode: 'upload',
    storeId: payload.storeId,
    attempt: context.attempt,
    totalFiles,
    filesProcessed,
    filesFailed,
    // 0 files is treated as fully done rather than divide-by-zero — an empty
    // upload has nothing left to do.
    percentComplete: totalFiles === 0 ? 100 : Math.round((filesProcessed / totalFiles) * 100),
    totalItemsMatched: summary.totalItemsMatched,
    totalItemsDrafted: summary.totalItemsDrafted,
    files: summary.files,
    completedAt: new Date().toISOString(),
  };
}
