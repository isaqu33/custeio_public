import { XMLParser } from 'fast-xml-parser';
import { allocateLandedValues } from './nfe-landed-cost';

// Plain `Error`, not the typed `BadRequestError` from `./errors` — that module
// pulls in `auth.ts`/next-auth, which the Bull worker process cannot load (no
// `server-only` shim outside Next.js). See scripts/check-worker-imports.mjs.
// The API route that accepts an upload is the HTTP boundary and may still
// translate a caught message into a real BadRequestError there.

/** One `det/prod` line of the NFe — everything Tier 1/2 need to turn it into a
 * `RawIngredient` + `SupplierItemMappings` entry. */
export type NfeItem = {
  supplierItemCode: string; // cProd
  description: string; // xProd
  gtin?: string; // cEAN — Tier 3, not used yet, kept for later
  commercialUnit: string; // uCom
  commercialQuantity: number; // qCom
  taxUnit: string; // uTrib
  taxQuantity: number; // qTrib
  totalValue: number; // vProd — the line's total value, see stock-and-cmv.md
  /**
   * What the line really cost: vProd plus its own freight/insurance/other
   * expenses, minus its own discount, plus its share of whatever the invoice
   * total (vNF) adds on top of the items — note-level freight, other expenses,
   * IPI, ST, note-level discounts. This, not vProd, is what stock is costed at.
   */
  landedValue: number;
};

export type ParsedNfe = {
  accessKey: string; // 44-digit chave de acesso
  issuedAt: Date;
  totalValue: number; // total NF value (ICMSTot/vNF)
  supplierCnpj: string; // emit/CNPJ, digits only
  supplierName: string; // emit/xNome (razão social)
  supplierTradeName?: string; // emit/xFant (nome fantasia) — what people actually call the supplier
  number?: string; // ide/nNF
  series?: string; // ide/serie
  itemsValue: number; // Σ vProd
  /** vNF − Σ vProd: freight + other expenses + IPI/ST − discounts, all invoice-wide. */
  adjustmentsValue: number;
  items: NfeItem[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Parses a `procNFe`/`NFe` XML (the full invoice, with items — a `resNFe`
 * summary has none and is rejected). Throws a plain `Error` with a message
 * meant to be shown as-is for anything that doesn't parse into a recognizable
 * NFe — `captureNfeFilesForStore` catches it per file rather than failing the
 * whole batch.
 */
export function parseNfeXml(xml: string): ParsedNfe {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('This file is not valid XML.');
  }

  // Accepts both the bare `<NFe>` root and the `<nfeProc>` wrapper (NFe +
  // authorization protocol) that SEFAZ distribution actually returns.
  const nfeProc = doc.nfeProc as Record<string, unknown> | undefined;
  const nfe = (nfeProc?.NFe ?? doc.NFe) as Record<string, unknown> | undefined;
  const infNFe = nfe?.infNFe as Record<string, unknown> | undefined;
  if (!infNFe) {
    throw new Error(
      'This file has no items to read — it may be a resNFe summary, not the full NFe.',
    );
  }

  const id = String(infNFe['@_Id'] ?? '');
  const accessKeyFromId = id.replace(/^NFe/, '');
  const protNFe = nfeProc?.protNFe as Record<string, unknown> | undefined;
  const infProt = protNFe?.infProt as Record<string, unknown> | undefined;
  const accessKey = digitsOnly(infProt?.chNFe) || digitsOnly(accessKeyFromId);
  if (accessKey.length !== 44) {
    throw new Error('Could not read this NFe’s access key.');
  }

  const ide = infNFe.ide as Record<string, unknown> | undefined;
  const emit = infNFe.emit as Record<string, unknown> | undefined;
  const total = infNFe.total as Record<string, unknown> | undefined;
  const icmsTot = total?.ICMSTot as Record<string, unknown> | undefined;

  const issuedAt = new Date(String(ide?.dhEmi ?? ide?.dEmi ?? ''));
  if (Number.isNaN(issuedAt.getTime())) {
    throw new Error('Could not read this NFe’s issue date.');
  }

  const supplierCnpj = digitsOnly(emit?.CNPJ);
  if (!supplierCnpj) {
    throw new Error('Could not read the supplier’s CNPJ.');
  }

  const detList = asArray(infNFe.det as Record<string, unknown> | Record<string, unknown>[]);
  const lineBases: number[] = [];
  const items: NfeItem[] = detList.map((det) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>;
    // The line's own extras: freight, insurance and other expenses add, a discount subtracts.
    lineBases.push(
      toNumber(prod.vProd) +
        toNumber(prod.vFrete) +
        toNumber(prod.vSeg) +
        toNumber(prod.vOutro) -
        toNumber(prod.vDesc),
    );
    return {
      supplierItemCode: String(prod.cProd ?? '').trim(),
      description: String(prod.xProd ?? '').trim(),
      gtin: prod.cEAN && prod.cEAN !== 'SEM GTIN' ? String(prod.cEAN).trim() : undefined,
      commercialUnit: String(prod.uCom ?? '').trim(),
      commercialQuantity: toNumber(prod.qCom),
      taxUnit: String(prod.uTrib ?? '').trim(),
      taxQuantity: toNumber(prod.qTrib),
      totalValue: toNumber(prod.vProd),
      landedValue: 0, // filled in below, once every line's base is known
    };
  });

  const totalValue = toNumber(icmsTot?.vNF);
  const { landed } = allocateLandedValues(lineBases, totalValue);
  items.forEach((item, index) => {
    item.landedValue = landed[index] ?? item.totalValue;
  });
  const itemsValue = items.reduce((sum, item) => sum + item.totalValue, 0);

  const supplierName = String(emit?.xNome ?? '').trim();
  const supplierTradeName = String(emit?.xFant ?? '').trim();
  const number = String(ide?.nNF ?? '').trim();
  const series = String(ide?.serie ?? '').trim();
  return {
    accessKey,
    issuedAt,
    totalValue,
    supplierCnpj,
    supplierName: supplierName || supplierCnpj,
    supplierTradeName: supplierTradeName || undefined,
    number: number || undefined,
    series: series || undefined,
    itemsValue,
    adjustmentsValue: totalValue > 0 ? totalValue - itemsValue : 0,
    items,
  };
}

/** What a `resNFe` summary carries: enough to know a purchase exists, never its items. */
export type NfeSummary = {
  accessKey: string;
  issuedAt: Date;
  totalValue: number;
  supplierCnpj: string;
  supplierName: string;
};

/**
 * Parses the `resNFe` SEFAZ hands out before the recipient's manifestation. Same plain-`Error`
 * contract as `parseNfeXml`: the sync catches it per document.
 */
export function parseNfeSummaryXml(xml: string): NfeSummary {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('This file is not valid XML.');
  }
  const res = doc.resNFe as Record<string, unknown> | undefined;
  if (!res) throw new Error('This file is not a resNFe summary.');

  const accessKey = digitsOnly(res.chNFe);
  if (accessKey.length !== 44) throw new Error('Could not read this summary’s access key.');
  const issuedAt = new Date(String(res.dhEmi ?? ''));
  if (Number.isNaN(issuedAt.getTime()))
    throw new Error('Could not read this summary’s issue date.');

  return {
    accessKey,
    issuedAt,
    totalValue: toNumber(res.vNF),
    supplierCnpj: digitsOnly(res.CNPJ),
    supplierName: String(res.xNome ?? '').trim(),
  };
}
