/**
 * Manual test of the recipient's manifestation "Ciência da Operação" (event 210210) for ONE NFe,
 * through the national `NFeRecepcaoEvento` service. Writes nothing to the database.
 *
 * It is a fiscal act registered in the store's name, signed with its e-CNPJ A1. So the default is a
 * DRY RUN: it builds and signs the event, verifies the signature locally and prints a summary, but
 * sends nothing. Sending needs `--send`.
 *
 * The certificate password is read from SEFAZ_PFX_PASSWORD in .env (never as an argument). The
 * private key goes through memory only: it is neither written to disk nor printed.
 *
 * Usage:
 *   npx tsx scripts/dev/sefaz-ciencia.ts --pfx <file.pfx> --chave <44 digits> [--tpAmb 1] [--send]
 *
 * What is expected back: `cStat 128` (batch processed) and, inside it, `135` (event registered).
 * `573` means the manifestation was already there (duplicate).
 */
import '../load-env';
import { execFileSync } from 'node:child_process';
import { createHash, createSign, createVerify } from 'node:crypto';
import { request } from 'node:https';
import { XMLParser } from 'fast-xml-parser';

const URLS = {
  1: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
} as const;
const WSDL_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const NFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Key and certificate out of the .pfx, by `openssl`; the password travels in the environment. */
function readPfx(pfxPath: string, passphrase: string) {
  const pem = execFileSync(
    'openssl',
    ['pkcs12', '-in', pfxPath, '-passin', 'env:PFX_PASS', '-nodes', '-clcerts'],
    { env: { ...process.env, PFX_PASS: passphrase }, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
  const key =
    /-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/.exec(
      pem,
    )?.[0];
  const cert = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pem)?.[0];
  if (!key || !cert) throw new Error('Could not read the key and the certificate from the .pfx.');
  return { key, cert, certBase64: cert.replace(/-----[^-]+-----|\s/g, '') };
}

/** "2026-10-06T13:05:00-03:00" — the clock of Brasília, as the event expects. */
function brasiliaTimestamp(now: Date): string {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

function buildSignedEvent(input: {
  chave: string;
  cnpj: string;
  tpAmb: 1 | 2;
  key: string;
  cert: string;
  certBase64: string;
  now: Date;
}) {
  const id = `ID210210${input.chave}01`;
  // Written already in canonical form (C14N 1.0): the namespace first, attributes sorted, no
  // whitespace, no self-closing tags. That way the digest below is over exactly what SEFAZ canonicalizes.
  const infEvento =
    `<infEvento xmlns="${NFE_NAMESPACE}" Id="${id}">` +
    `<cOrgao>91</cOrgao><tpAmb>${input.tpAmb}</tpAmb><CNPJ>${input.cnpj}</CNPJ>` +
    `<chNFe>${input.chave}</chNFe><dhEvento>${brasiliaTimestamp(input.now)}</dhEvento>` +
    '<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>' +
    '<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>' +
    '</infEvento>';

  const digest = createHash('sha1').update(infEvento, 'utf8').digest('base64');
  const signedInfoBody =
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${DSIG}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>`;
  const signedInfoCanonical = `<SignedInfo xmlns="${DSIG}">${signedInfoBody}</SignedInfo>`;
  const signatureValue = createSign('RSA-SHA1')
    .update(signedInfoCanonical, 'utf8')
    .sign(input.key, 'base64');

  const signature =
    `<Signature xmlns="${DSIG}"><SignedInfo>${signedInfoBody}</SignedInfo>` +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${input.certBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;

  const envEvento =
    `<envEvento xmlns="${NFE_NAMESPACE}" versao="1.00"><idLote>1</idLote>` +
    `<evento xmlns="${NFE_NAMESPACE}" versao="1.00">${infEvento.replace(` xmlns="${NFE_NAMESPACE}"`, '')}${signature}</evento></envEvento>`;

  // Local proof that digest and signature are consistent (it does not replace SEFAZ's validation).
  const digestOk = createHash('sha1').update(infEvento, 'utf8').digest('base64') === digest;
  const signatureOk = createVerify('RSA-SHA1')
    .update(signedInfoCanonical, 'utf8')
    .verify(input.cert, signatureValue, 'base64');

  const soap =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${WSDL_NAMESPACE}">${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  return { id, soap, digestOk, signatureOk };
}

async function send(soap: string, tpAmb: 1 | 2, pfx: Buffer, passphrase: string): Promise<string> {
  const url = new URL(URLS[tpAmb]);
  return new Promise<string>((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        pfx,
        passphrase,
        minVersion: 'TLSv1.2',
        timeout: 30_000,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${WSDL_NAMESPACE}/nfeRecepcaoEvento"`,
          'Content-Length': Buffer.byteLength(soap),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve(`HTTP ${res.statusCode}\n${Buffer.concat(chunks).toString('utf8')}`),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout after 30s')));
    req.on('error', reject);
    req.end(soap);
  });
}

async function main() {
  const pfxPath = arg('pfx');
  const chave = arg('chave');
  const passphrase = process.env.SEFAZ_PFX_PASSWORD;
  const tpAmb = (arg('tpAmb') ?? '1') === '2' ? 2 : 1;
  if (!pfxPath || !chave || !/^\d{44}$/.test(chave)) {
    console.error(
      'usage: sefaz-ciencia.ts --pfx <file.pfx> --chave <44 digits> [--tpAmb 1] [--send]',
    );
    process.exit(1);
  }
  if (!passphrase) throw new Error('Set SEFAZ_PFX_PASSWORD in .env.');

  const { key, cert, certBase64 } = readPfx(pfxPath, passphrase);
  const cnpj = /CN=[^:]*:(\d{14})/.exec(
    execFileSync('openssl', ['x509', '-noout', '-subject'], { input: cert }).toString(),
  )?.[1];
  if (!cnpj) throw new Error('Could not read the CNPJ from the certificate subject.');

  const event = buildSignedEvent({ chave, cnpj, tpAmb, key, cert, certBase64, now: new Date() });
  console.log(`event ${event.id} · CNPJ do certificado ${cnpj} · tpAmb=${tpAmb}`);
  console.log(
    `digest consistente: ${event.digestOk} · assinatura confere com o certificado: ${event.signatureOk}`,
  );
  if (!event.digestOk || !event.signatureOk)
    throw new Error('Local signature check failed; not sending.');

  if (!process.argv.includes('--send')) {
    console.log('DRY RUN: nada foi enviado. Use --send para registrar a Ciência da Operação.');
    return;
  }

  const answer = await send(
    event.soap,
    tpAmb,
    (await import('node:fs')).readFileSync(pfxPath),
    passphrase,
  );
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
  }).parse(answer.slice(answer.indexOf('\n') + 1)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ret = parsed?.Envelope?.Body?.nfeRecepcaoEventoNFResult?.retEnvEvento;
  const info = ret?.retEvento?.infEvento;
  console.log(answer.split('\n')[0]);
  if (!ret) {
    console.log(answer.slice(0, 600));
    return;
  }
  console.log(`lote:   cStat=${ret.cStat} ${ret.xMotivo}`);
  if (info)
    console.log(
      `evento: cStat=${info.cStat} ${info.xMotivo}${info.nProt ? ` · protocolo ${info.nProt}` : ''}`,
    );
}

void main().catch((err) => {
  console.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
});
