import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '@/app/lib/env';
import { INITIAL_NSU, type DistNsuDocument, type DistNsuResult } from '@/app/lib/sefaz-client';

// Plain `Error`, not `./errors` — this is imported by the Bull worker (see
// scripts/check-worker-imports.mjs).

/** SEFAZ hands out at most 50 documents per `distNSU` call; the simulated
 * source keeps the same batch size so the job behaves the same either way. */
export const SEFAZ_BATCH_SIZE = 50;

export type SefazBatch = DistNsuResult & {
  // True when nothing real was called — the caller must not count it toward
  // the 20/h ceiling.
  simulated: boolean;
};

const FILE_PATTERN = /^(\d{15})-(.+)\.xml$/;

/**
 * Pure: the batch a `distNSU` call would return from `files` (NSU + schema +
 * content) after the cursor. `files` need not be sorted. Answers `137` when
 * nothing is left — exactly like the real service at the end of its sequence.
 */
export function buildSimulatedBatch(
  files: DistNsuDocument[],
  ultNSU: string,
  batchSize: number = SEFAZ_BATCH_SIZE,
): DistNsuResult {
  const sorted = [...files].sort((a, b) => a.nsu.localeCompare(b.nsu));
  const maxNSU = sorted.length > 0 ? (sorted[sorted.length - 1] as DistNsuDocument).nsu : ultNSU;
  const pending = sorted.filter((doc) => doc.nsu > ultNSU);
  const documents = pending.slice(0, batchSize);

  if (documents.length === 0) {
    return { cStat: '137', xMotivo: 'Nenhum documento localizado', ultNSU, maxNSU, documents: [] };
  }
  return {
    cStat: '138',
    xMotivo: 'Documento localizado',
    ultNSU: (documents[documents.length - 1] as DistNsuDocument).nsu,
    maxNSU,
    documents,
  };
}

function readSimulatedFiles(dir: string): DistNsuDocument[] {
  const files: DistNsuDocument[] = [];
  for (const name of readdirSync(dir)) {
    // `!name.startsWith('.')` also skips AppleDouble sidecars (`._x`) that the
    // exFAT dev drive grows next to real files.
    const match = name.startsWith('.') ? null : FILE_PATTERN.exec(name);
    if (!match) continue;
    files.push({
      nsu: match[1] as string,
      schema: match[2] as string,
      xml: readFileSync(join(dir, name), 'utf8'),
    });
  }
  return files;
}

/** Whether `fetchSefazBatch` serves fixtures — known before the call, so the
 * usage log can book it as simulated (never counted) up front. */
export const isSimulatedSource = () => env.SEFAZ_SOURCE !== 'live';

/** One `distNSU`-shaped call against whichever source is configured. */
export async function fetchSefazBatch(input: { ultNSU?: string }): Promise<SefazBatch> {
  const ultNSU = input.ultNSU || INITIAL_NSU;

  if (env.SEFAZ_SOURCE === 'live') {
    // The real call needs the store's e-CNPJ A1, and where that certificate
    // lives is still an open decision (docs/features/sefaz-nfe.md). Failing
    // loudly beats silently serving fixtures as if they were real.
    throw new Error('SEFAZ_SOURCE=live is not available yet: certificate custody is undecided.');
  }

  const dir = env.SEFAZ_SIMULATED_DIR;
  if (!dir) throw new Error('SEFAZ_SOURCE=simulated needs SEFAZ_SIMULATED_DIR.');

  return { ...buildSimulatedBatch(readSimulatedFiles(dir), ultNSU), simulated: true };
}
