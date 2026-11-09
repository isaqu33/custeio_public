import { extractText, getDocumentProxy } from 'unpdf';
import { allocateLandedValues } from './nfe-landed-cost';
import type { NfeItem, ParsedNfe } from './nfe-xml';

// Reads a DANFE (the printed/PDF representation of an NFe) instead of the XML
// itself — for an owner who only has the PDF the supplier emailed, not the
// structured document. Everything here is best-effort text-layout parsing,
// unlike `nfe-xml.ts`'s exact schema read, because a PDF has no schema: two
// suppliers' invoicing software can print the same numbers in a different
// layout, and PDF text extraction returns runs in the order the file's
// content stream happens to place them, not necessarily left-to-right,
// top-to-bottom reading order.
//
// What is NOT best-effort, because it is fiscally standardized regardless of
// which software issued the DANFE (Manual de Orientação do Contribuinte —
// the national layout, not a per-ERP choice):
//   - the 44-digit chave de acesso, printed as plain text (validated below
//     with its own check digit, so a misread here is caught, not silently
//     wrong);
//   - the "RECEBEMOS DE <fornecedor> OS PRODUTOS..." receipt sentence;
//   - "EMISSÃO: DD/MM/AAAA" and "VALOR TOTAL: R$X" in that same sentence.
// Those four are read the same way from every DANFE tried so far (see
// docs/features/sefaz-nfe.md) and are trusted outright.
//
// The item table IS per-ERP layout, so each candidate line is additionally
// self-checked (quantity × unit price ≈ line total, within a cent) before
// being accepted — a line that does not check out is dropped rather than
// drafted with a guessed quantity, the same "do not guess" rule
// `packSizeFromDescription` (app/lib/ingredient-naming.ts) already follows.
// Validated once, against one real single-item invoice (a Pão Ayres DANFE,
// 2026-09-27) — expect it to need widening as more suppliers' PDFs turn up.

const WEIGHTS_MOD11 = [2, 3, 4, 5, 6, 7, 8, 9];

/** The access key's own check digit (mod-11 over its first 43 digits) — this
 * is what lets a misread 44-digit run be told apart from a real key. */
function accessKeyChecksOut(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let total = 0;
  const digits = key.slice(0, 43).split('').reverse();
  for (let i = 0; i < digits.length; i += 1) {
    total += Number(digits[i]) * WEIGHTS_MOD11[i % WEIGHTS_MOD11.length]!;
  }
  const remainder = total % 11;
  const expected = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return expected === Number(key[43]);
}

/** "1.449,90" -> 1449.9. Returns 0 for anything that does not parse — callers
 * treat a missing number as "not found", never as a real zero to act on. */
function parseBrNumber(text: string | undefined): number {
  if (!text) return 0;
  const value = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

function decodeAccessKey(key: string) {
  return {
    supplierCnpj: key.slice(6, 20),
    series: String(Number(key.slice(22, 25))),
    number: String(Number(key.slice(25, 34))),
  };
}

// The standard printed grouping — 11 blocks of 4 digits ("5226 0958 8740
// 9500 ..."), space- or newline-separated — not just any 44-digit run: a
// DANFE also prints a lone "1" right above the key (the "0: Entrada / 1:
// Saída" box), and a looser pattern can swallow it into a shifted, wrong
// 44-digit window. Matched anywhere in the page, then checksum-validated —
// cheaper and more robust than anchoring on the "CHAVE DE ACESSO" label,
// whose surrounding layout varies.
// A fixed {10} repetition of a fixed-length, non-overlapping group (\d{4} vs
// [ \n] share no characters) cannot backtrack catastrophically; the lint
// rule's heuristic flags any repeated \d{n} regardless.
// eslint-disable-next-line security/detect-unsafe-regex
const ACCESS_KEY_PATTERN = /(?:\d{4}[ \n]){10}\d{4}/g;

function findAccessKey(text: string): string | undefined {
  for (const match of text.matchAll(ACCESS_KEY_PATTERN)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length === 44 && accessKeyChecksOut(digits)) return digits;
  }
  return undefined;
}

// The mandatory receipt sentence (canhoto) at the top of every DANFE, e.g.
// "RECEBEMOS DE PAO AYRES COMERCIO E INDUSTRIA LTDA OS PRODUTOS E/OU
// SERVIÇOS ... EMISSÃO: 27/09/2026 VALOR TOTAL: R$1.449,90 DESTINATÁRIO: ...".
const RECEIPT_PATTERN =
  /RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS[\s\S]*?EMISSÃO:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?VALOR TOTAL:\s*R\$\s*([\d.,]+)/i;

const NUM = String.raw`\d{1,3}(?:\.\d{3})*,\d{2,4}`;
// CÓDIGO(0-N)  DESCRIÇÃO  CFOP  UN  QUANT  V.UNIT  V.TOTAL — see the module
// comment for why only the CFOP→UN→3-numbers shape is trusted, not the
// columns around it. CFOP's first digit is always 1, 2, 3, 5, 6 or 7 (entrada/
// saída × estadual/interestadual/exterior), which keeps this from firing on
// an unrelated 4-digit number elsewhere in the page.
const ITEM_ANCHOR = new RegExp(
  String.raw`([1235-7]\d{3})\s+([A-ZÀ-Ü0-9]{2,10})\s+(${NUM})\s+(${NUM})\s+(${NUM})`,
  'g',
);

// The item table's column headers ("CÓDIGO PRODUTO", "DESCRIÇÃO...", "NCM/SH",
// ..., ending in "O/CSOSN") sit BEFORE the first row in the extracted text,
// same as the data. "O/CSOSN" is distinctive enough (unlike "UN" or "CFOP",
// which are also real per-row values) that skipping past it is a safe way to
// stop the header text itself from being read as the first item's
// description — without it, the whole header row leaks into that description.
const LAST_HEADER_LABEL = /O\s*\/\s*CSOSN/i;

function parseItems(productSectionText: string): NfeItem[] {
  const items: NfeItem[] = [];
  const headerEnd = productSectionText.match(LAST_HEADER_LABEL);
  let cursor = headerEnd ? headerEnd.index! + headerEnd[0].length : 0;
  for (const match of productSectionText.matchAll(ITEM_ANCHOR)) {
    const [, , unit, quantityText, unitPriceText, totalText] = match;
    const quantity = parseBrNumber(quantityText);
    const unitPrice = parseBrNumber(unitPriceText);
    const total = parseBrNumber(totalText);
    // The self-check: a spurious match (three unrelated tax-box numbers
    // that happen to sit near a CFOP-shaped number) essentially never
    // multiplies out like this by chance.
    if (quantity <= 0 || Math.abs(quantity * unitPrice - total) > 0.02) continue;

    const between = productSectionText.slice(cursor, match.index).trim();
    const description = between
      // The código produto column, when it is a short standalone number.
      .replace(/^\d{1,6}\s+/, '')
      // A trailing O/CSOSN tax-situation code ("0/102"), printed right
      // after the description on this layout rather than at the row's end.
      .replace(/\s+\d{1,3}\/\d{1,3}$/, '')
      .trim();
    if (description) {
      items.push({
        // A DANFE has no supplier SKU we can read reliably (the "código
        // produto" column is per-issuer and already folded into
        // `description` above) — a slug of the name is the stable key
        // instead, so a second purchase of "Pão Brioche No Aro" matches the
        // same SupplierItemMappings entry. Diacritics stripped the same way
        // `normalizeForComparison` (nfe-capture.ts) does, so "Pão" and a
        // future "PAO" from a different DANFE font slug the same.
        supplierItemCode: description
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60),
        description,
        commercialUnit: unit!,
        commercialQuantity: quantity,
        taxUnit: unit!,
        taxQuantity: quantity,
        totalValue: total,
        landedValue: 0,
      });
    }
    cursor = match.index! + match[0].length;
  }
  return items;
}

/** The pure, synchronous half — parses already-extracted page text. Split out
 * from `parseNfePdf` so it can be unit-tested against a synthetic fixture
 * shaped like a real DANFE's extracted text, without a binary PDF fixture. */
export function parseNfeText(text: string): ParsedNfe {
  const accessKey = findAccessKey(text);
  if (!accessKey) {
    throw new Error('Could not read this PDF’s access key — is it a DANFE?');
  }

  const receipt = text.match(RECEIPT_PATTERN);
  if (!receipt) {
    throw new Error('Could not read this DANFE’s receipt line (supplier, date, total).');
  }
  const [, supplierName, dateText, totalText] = receipt;
  const [day, month, year] = dateText!.split('/');
  const issuedAt = new Date(`${year}-${month}-${day}T12:00:00`);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new Error('Could not read this DANFE’s issue date.');
  }
  const totalValue = parseBrNumber(totalText);

  const { supplierCnpj, series, number } = decodeAccessKey(accessKey);

  // Best-effort only: the item table between these two standardized box
  // titles. Absent either marker, or with nothing recognizable inside,
  // `items` stays empty — the invoice is still captured (Part 1), just with
  // nothing auto-drafted (see docs/features/sefaz-nfe.md).
  const tableStart = text.search(/DADOS DO PRODUTO/i);
  const tableEnd = text.search(/DADOS ADICIONAIS/i);
  const productSection =
    tableStart >= 0 ? text.slice(tableStart, tableEnd >= 0 ? tableEnd : undefined) : '';
  const items = productSection ? parseItems(productSection) : [];

  const { landed } = allocateLandedValues(
    items.map((item) => item.totalValue),
    totalValue,
  );
  items.forEach((item, index) => {
    item.landedValue = landed[index] ?? item.totalValue;
  });
  const itemsValue = items.reduce((sum, item) => sum + item.totalValue, 0);

  return {
    accessKey,
    issuedAt,
    totalValue,
    supplierCnpj,
    supplierName: supplierName!.trim(),
    number,
    series,
    itemsValue,
    adjustmentsValue: totalValue > 0 ? totalValue - itemsValue : 0,
    items,
  };
}

/** Extracts the page text (via `unpdf`, a Node-safe pdf.js build — no DOM, so
 * it also loads under the Bull worker's plain `tsx`, see
 * scripts/check-worker-imports.mjs) and parses it. */
export async function parseNfePdf(bytes: Uint8Array): Promise<ParsedNfe> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    throw new Error('This file is not a readable PDF.');
  }
  return parseNfeText(text);
}
