/**
 * One-off: fills `nfe_documents` for what the store captured BEFORE the Notas screen existed.
 *
 *  - every invoice in `processed_invoices` gets a "full" document, with its XML when the file is in
 *    the simulated SEFAZ folder (SEFAZ_SIMULATED_DIR) — the XML was never kept, so this folder is
 *    the only place it still lives — and without one when it came from a PDF or an upload;
 *  - every `resNFe` in that folder whose note was never captured becomes a "summary" (a preview).
 *
 * Idempotent: running it twice changes nothing the second time. DRY RUN by default; `--apply` writes.
 *
 * Usage:
 *   npx tsx scripts/dev/backfill-nfe-documents.ts --store <storeId> [--apply]
 */
import '../load-env';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import {
  parseNfeSummaryXml,
  parseNfeXml,
  type NfeSummary,
  type ParsedNfe,
} from '../../app/lib/nfe-xml';
import { recordNfeFull, recordNfeSummary } from '../../app/lib/services/nfe-documents';
import NfeDocumentDB from '../../app/models/nfe-documents';
import ProcessedInvoiceDB from '../../app/models/processed-invoices';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const storeId = arg('store');
  const apply = process.argv.includes('--apply');
  const dir = process.env.SEFAZ_SIMULATED_DIR;
  if (!storeId) throw new Error('--store <storeId> is required.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(process.env.DATABASE_URL);

  const full = new Map<string, { parsed: ParsedNfe; xml: string; nsu: string }>();
  const summaries = new Map<string, { summary: NfeSummary; nsu: string }>();
  for (const name of dir ? readdirSync(dir).sort() : []) {
    const match = /^(\d{15})-(procNFe|resNFe)/.exec(name);
    if (!match) continue;
    const [, nsu, kind] = match as unknown as [string, string, string];
    const xml = readFileSync(join(dir as string, name), 'utf8');
    try {
      if (kind === 'procNFe') {
        const parsed = parseNfeXml(xml);
        full.set(parsed.accessKey, { parsed, xml, nsu });
      } else {
        const summary = parseNfeSummaryXml(xml);
        summaries.set(summary.accessKey, { summary, nsu });
      }
    } catch (err) {
      console.log(`  ignorado ${name}: ${(err as Error).message}`);
    }
  }

  const invoices = await ProcessedInvoiceDB.find({ storeId }).lean<
    Array<{
      accessKey: string;
      issuedAt: Date;
      totalValue: number;
      supplierCnpj?: string;
      supplierName?: string;
      number?: string;
      series?: string;
    }>
  >();
  const processedKeys = new Set(invoices.map((invoice) => invoice.accessKey));
  const existing = new Set(
    (
      await NfeDocumentDB.find({ storeId }).select('accessKey').lean<Array<{ accessKey: string }>>()
    ).map((doc) => doc.accessKey),
  );

  let withXml = 0;
  let withoutXml = 0;
  for (const invoice of invoices) {
    if (existing.has(invoice.accessKey)) continue;
    const file = full.get(invoice.accessKey);
    if (file) {
      withXml += 1;
      if (apply)
        await recordNfeFull(storeId, file.parsed, {
          xml: file.xml,
          source: 'sefaz',
          nsu: file.nsu,
        });
    } else {
      withoutXml += 1;
      if (apply)
        await NfeDocumentDB.updateOne(
          { storeId, accessKey: invoice.accessKey },
          {
            $setOnInsert: {
              level: 'full',
              supplierCnpj: invoice.supplierCnpj,
              supplierName: invoice.supplierName,
              number: invoice.number,
              series: invoice.series,
              issuedAt: invoice.issuedAt,
              totalValue: invoice.totalValue,
              source: 'upload',
              hasXml: false,
              fullAt: new Date(),
            },
          },
          { upsert: true },
        );
    }
  }

  // A summary is only a preview while the note was not read in full, here or in the folder.
  let previews = 0;
  for (const [key, { summary, nsu }] of summaries) {
    if (existing.has(key) || processedKeys.has(key) || full.has(key)) continue;
    previews += 1;
    if (apply) await recordNfeSummary(storeId, summary, { nsu });
  }

  console.log(
    `${apply ? 'APLICADO' : 'ENSAIO (nada gravado)'}: ${invoices.length} nota(s) capturada(s)`,
  );
  console.log(`  com XML recuperado da pasta: ${withXml}`);
  console.log(`  sem XML (PDF/upload ou fora da pasta): ${withoutXml}`);
  console.log(`  prévias (resumo sem a nota completa): ${previews}`);
}

void main()
  .catch((err) => {
    console.error(String(err).slice(0, 400));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    process.exit(process.exitCode ?? 0);
  });
