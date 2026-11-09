/**
 * Manual smoke test for the SEFAZ `NFeDistribuicaoDFe` client: ONE `distNSU`
 * call, printed and forgotten. Writes nothing to the database and never
 * retries — the 20 queries/hour per CNPJ ceiling (docs/features/sefaz-nfe.md)
 * is real, and a `656` blocks the CNPJ for an hour.
 *
 * The certificate password is read from SEFAZ_PFX_PASSWORD in .env. Never pass
 * it as an argument.
 *
 * Usage:
 *   npx tsx scripts/dev/sefaz-dist-nsu.ts --pfx <file.pfx> --cnpj <14 digits> \
 *     [--uf 35] [--tpAmb 2] [--ultNSU 000000000000000] [--out <dir>] [--store <storeId>]
 *
 * `--store` logs the call in `sefaz_requests` (the API-usage counter). Without it the
 * script touches no database.
 *
 * `--out` saves each received document as <NSU>-<schema>.xml so a single call
 * is enough to keep what came back (fiscal data: keep the folder out of git).
 */
import '../load-env';
import mongoose from 'mongoose';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INITIAL_NSU,
  SEFAZ_DISTRIBUICAO_URLS,
  SefazBlockedError,
  distNsuQuery,
  type SefazEnvironment,
} from '../../app/lib/sefaz-client';
import { recordSefazRequest } from '../../app/lib/services/sefaz-requests';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const pfxPath = arg('pfx');
  const cnpj = arg('cnpj');
  if (!pfxPath || !cnpj) {
    console.error(
      'usage: sefaz-dist-nsu.ts --pfx <file.pfx> --cnpj <14 digits> [--uf 35] [--tpAmb 2] [--ultNSU N]',
    );
    process.exit(1);
  }

  const tpAmbArg = arg('tpAmb') ?? '2';
  if (tpAmbArg !== '1' && tpAmbArg !== '2') {
    console.error('--tpAmb must be 1 (produção) or 2 (homologação).');
    process.exit(1);
  }
  const tpAmb = Number(tpAmbArg) as SefazEnvironment;

  const passphrase = process.env.SEFAZ_PFX_PASSWORD;
  if (!passphrase) {
    console.error('Set SEFAZ_PFX_PASSWORD in .env.');
    process.exit(1);
  }

  const storeId = arg('store');
  const ultNSU = arg('ultNSU') ?? INITIAL_NSU;
  console.log(`tpAmb=${tpAmb} url=${SEFAZ_DISTRIBUICAO_URLS[tpAmb]} ultNSU=${ultNSU}`);

  try {
    const result = await distNsuQuery({
      pfx: readFileSync(pfxPath),
      passphrase,
      cnpj,
      cUFAutor: arg('uf') ?? '35',
      tpAmb,
      ultNSU,
    });
    if (storeId) {
      await recordSefazRequest({
        storeId,
        tpAmb,
        cStat: result.cStat,
        xMotivo: result.xMotivo,
        ultNSU: result.ultNSU,
        maxNSU: result.maxNSU,
        documentsCount: result.documents.length,
      });
    }
    console.log(`cStat=${result.cStat} xMotivo=${result.xMotivo}`);
    console.log(
      `ultNSU=${result.ultNSU} maxNSU=${result.maxNSU} documents=${result.documents.length}`,
    );
    for (const doc of result.documents) {
      console.log(`  NSU ${doc.nsu}  ${doc.schema}  ${doc.xml.length} chars`);
    }
    const outDir = arg('out');
    if (outDir && result.documents.length > 0) {
      mkdirSync(outDir, { recursive: true });
      for (const doc of result.documents) {
        writeFileSync(join(outDir, `${doc.nsu}-${doc.schema}.xml`), doc.xml);
      }
      console.log(`saved ${result.documents.length} file(s) to ${outDir}`);
    }
  } catch (err) {
    if (err instanceof SefazBlockedError) {
      if (storeId) {
        await recordSefazRequest({
          storeId,
          tpAmb,
          cStat: '656',
          documentsCount: 0,
          blockedUntil: err.blockedUntil,
        });
      }
      console.error(`BLOCKED until ${err.blockedUntil.toISOString()} — do NOT retry before then.`);
    } else {
      console.error(`${(err as Error).name}: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

void main().finally(async () => {
  // `--store` opens a Mongo connection that would otherwise keep the process alive.
  await mongoose.disconnect();
  process.exit(process.exitCode ?? 0);
});
