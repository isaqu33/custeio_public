import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

// Plain `Error` subclasses, not `./errors` — that module pulls in next-auth,
// which the Bull worker cannot load (see scripts/check-worker-imports.mjs).

/** `cStat 656`: SEFAZ blocked this CNPJ for an hour. The caller must stop
 * polling — retrying before `blockedUntil` resets the block's clock. */
export class SefazBlockedError extends Error {
  constructor(
    message: string,
    readonly blockedUntil: Date,
  ) {
    super(message);
    this.name = 'SefazBlockedError';
  }
}

/** Network/TLS/HTTP/SOAP-shape failure — nothing to do with a `cStat`. */
export class SefazTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SefazTransportError';
  }
}

export type SefazEnvironment = 1 | 2; // tpAmb: 1 production / 2 homologação

// Ambiente Nacional, one national host regardless of the taxpayer's state.
// Taken from the sped-nfe reference config (2026-09-24) — the official WSDL
// was not reachable when this was written, so confirm before trusting `hom1`.
export const SEFAZ_DISTRIBUICAO_URLS: Record<SefazEnvironment, string> = {
  1: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

const WSDL_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const SOAP_ACTION = `${WSDL_NAMESPACE}/nfeDistDFeInteresse`;
const REQUEST_TIMEOUT_MS = 30_000;
const BLOCK_DURATION_MS = 60 * 60 * 1000;

export const INITIAL_NSU = '000000000000000';

// Per CNPJ/certificate, sliding hour (docs/features/sefaz-nfe.md, researched 2026-09-22).
export const SEFAZ_DIST_HOURLY_LIMIT = 20;

export type DistNsuInput = {
  /** The e-CNPJ A1 (`.pfx`) — presented on the TLS connection (mTLS). */
  pfx: Buffer;
  passphrase: string;
  /** CNPJ of the Store doing the query, digits only. */
  cnpj: string;
  /** IBGE code of the querying CNPJ's state, e.g. `35` for SP. */
  cUFAutor: string;
  tpAmb: SefazEnvironment;
  /** Cursor: last NSU already processed; `INITIAL_NSU` on the first call. */
  ultNSU: string;
  /** Override for tests / the day the URL moves. Defaults per `tpAmb`. */
  url?: string;
  /** Extra CA certificates (PEM) if Node's store doesn't trust the ICP-Brasil chain. */
  ca?: string | Buffer | Array<string | Buffer>;
};

export type DistNsuDocument = {
  nsu: string;
  /** e.g. `resNFe_v1.01`, `procNFe_v4.00` — says what `xml` holds. */
  schema: string;
  xml: string;
};

export type DistNsuResult = {
  cStat: string;
  xMotivo: string;
  ultNSU?: string;
  maxNSU?: string;
  /** A full batch (50) — more NSUs are waiting; the caller loops, not us. */
  documents: DistNsuDocument[];
};

const responseParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false, // keep NSU/cStat as strings (leading zeros matter)
  isArray: (name) => name === 'docZip',
});

export function buildDistNsuEnvelope(input: {
  cnpj: string;
  cUFAutor: string;
  tpAmb: SefazEnvironment;
  ultNSU: string;
}): string {
  if (!/^\d{14}$/.test(input.cnpj)) throw new Error('cnpj must be 14 digits.');
  if (!/^\d{2}$/.test(input.cUFAutor)) throw new Error('cUFAutor must be 2 digits.');
  if (!/^\d{15}$/.test(input.ultNSU)) throw new Error('ultNSU must be 15 digits.');

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    `<nfeDistDFeInteresse xmlns="${WSDL_NAMESPACE}">` +
    '<nfeDadosMsg>' +
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' +
    `<tpAmb>${input.tpAmb}</tpAmb>` +
    `<cUFAutor>${input.cUFAutor}</cUFAutor>` +
    `<CNPJ>${input.cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${input.ultNSU}</ultNSU></distNSU>` +
    '</distDFeInt>' +
    '</nfeDadosMsg>' +
    '</nfeDistDFeInteresse>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

/** Turns SEFAZ's SOAP answer into a typed result. Throws `SefazBlockedError`
 * on 656 and `SefazTransportError` if the body isn't the shape we expect. */
export function parseDistNsuResponse(xml: string, now: Date = new Date()): DistNsuResult {
  let parsed: unknown;
  try {
    parsed = responseParser.parse(xml);
  } catch {
    throw new SefazTransportError('SEFAZ response is not valid XML.');
  }

  const ret = (
    parsed as {
      Envelope?: {
        Body?: {
          nfeDistDFeInteresseResponse?: {
            nfeDistDFeInteresseResult?: { retDistDFeInt?: Record<string, unknown> };
          };
        };
      };
    }
  )?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;

  if (!ret || typeof ret.cStat !== 'string') {
    throw new SefazTransportError('SEFAZ response has no retDistDFeInt/cStat.');
  }

  const cStat = ret.cStat;
  const xMotivo = typeof ret.xMotivo === 'string' ? ret.xMotivo : '';

  if (cStat === '656') {
    // The block is 1h counted from the answer; fall back to `now` if dhResp is unreadable.
    const answeredAt = typeof ret.dhResp === 'string' ? new Date(ret.dhResp) : now;
    const base = Number.isNaN(answeredAt.getTime()) ? now : answeredAt;
    throw new SefazBlockedError(
      `SEFAZ 656: ${xMotivo || 'consumo indevido'}`,
      new Date(base.getTime() + BLOCK_DURATION_MS),
    );
  }

  const lote = ret.loteDistDFeInt as
    | { docZip?: Array<{ '@_NSU'?: string; '@_schema'?: string; '#text'?: string }> }
    | undefined;

  const documents: DistNsuDocument[] = (lote?.docZip ?? []).map((doc) => {
    try {
      return {
        nsu: doc['@_NSU'] ?? '',
        schema: doc['@_schema'] ?? '',
        xml: gunzipSync(Buffer.from(doc['#text'] ?? '', 'base64')).toString('utf8'),
      };
    } catch {
      throw new SefazTransportError(`docZip NSU ${doc['@_NSU'] ?? '?'} is not valid gzip/base64.`);
    }
  });

  return {
    cStat,
    xMotivo,
    ultNSU: typeof ret.ultNSU === 'string' ? ret.ultNSU : undefined,
    maxNSU: typeof ret.maxNSU === 'string' ? ret.maxNSU : undefined,
    documents,
  };
}

/**
 * EXACTLY ONE `distNSU` call — no retry, no loop, no persistence. The 20/h
 * per-CNPJ ceiling and the 656 block (docs/features/sefaz-nfe.md) make
 * pacing and cursor storage the caller's job; a client that retried on its
 * own could turn one failure into an hour-long block.
 */
export async function distNsuQuery(input: DistNsuInput): Promise<DistNsuResult> {
  const body = buildDistNsuEnvelope(input);
  const url = new URL(input.url ?? SEFAZ_DISTRIBUICAO_URLS[input.tpAmb]);

  const responseText = await new Promise<string>((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        pfx: input.pfx,
        passphrase: input.passphrase,
        ca: input.ca,
        minVersion: 'TLSv1.2',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          // SOAP 1.2: the action rides inside Content-Type, not a SOAPAction header.
          'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new SefazTransportError(`SEFAZ HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('error', (err) => reject(new SefazTransportError(err.message)));
    req.end(body);
  });

  return parseDistNsuResponse(responseText);
}
