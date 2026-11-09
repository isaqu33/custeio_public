import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { cleanIngredientName, suggestIngredientKind } from '@/app/lib/ingredient-naming';
import { flagManualOverlaps } from '@/app/lib/services/manual-overlaps';
import { logger } from '@/app/lib/logger';
import { toObjectId } from '@/app/lib/mongo-id';
import { parseNfeXml, type NfeItem, type ParsedNfe } from '@/app/lib/nfe-xml';
import { parseNfePdf } from '@/app/lib/nfe-pdf';
import { roundCost } from '@/app/lib/quantity-format';
import {
  createRawIngredientForStore,
  creditRawIngredientPurchase,
  type RawIngredientUnit,
} from '@/app/lib/services/raw-ingredients';
import { findRecordedCancellation } from '@/app/lib/services/nfe-cancellation';
import { recordNfeFull } from '@/app/lib/services/nfe-documents';
import { deleteMovement, recordPurchaseMovement } from '@/app/lib/services/stock-movements';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import RawIngredientDB from '@/app/models/raw-ingredients';
import SupplierItemMappingDB from '@/app/models/supplier-item-mappings';

export type NfeCaptureFileResult = {
  fileName: string;
  // 'cancelled': SEFAZ had already reported this NFe cancelled, so nothing was credited.
  status: 'processed' | 'duplicate' | 'cancelled' | 'error';
  error?: string;
  accessKey?: string;
  itemsMatched: number;
  itemsDrafted: number;
};

export type NfeCaptureSummary = {
  files: NfeCaptureFileResult[];
  totalItemsMatched: number;
  totalItemsDrafted: number;
};

// Real-world unit on the NFe (uTrib) -> our fixed 3-unit stock model. Anything
// unrecognized (UN, CX, PCT, FD, ...) is tracked as a whole "un" — the
// conversion factor derived below already folds the box/pack size in, so this
// only has to catch mass/volume that needs scaling into g/ml.
const UNIT_TO_INTERNAL: Record<string, { unit: RawIngredientUnit; multiplier: number }> = {
  KG: { unit: 'g', multiplier: 1000 },
  QUILO: { unit: 'g', multiplier: 1000 },
  QUILOGRAMA: { unit: 'g', multiplier: 1000 },
  G: { unit: 'g', multiplier: 1 },
  GR: { unit: 'g', multiplier: 1 },
  GRAMA: { unit: 'g', multiplier: 1 },
  GRAMAS: { unit: 'g', multiplier: 1 },
  L: { unit: 'ml', multiplier: 1000 },
  LT: { unit: 'ml', multiplier: 1000 },
  LITRO: { unit: 'ml', multiplier: 1000 },
  LITROS: { unit: 'ml', multiplier: 1000 },
  ML: { unit: 'ml', multiplier: 1 },
  MILILITRO: { unit: 'ml', multiplier: 1 },
};

// Some suppliers append one internal digit to the unit code — "KG1", "UN1",
// "UND9", "PCT9" — a fiscal-system quirk (SEFAZ itself just carries whatever
// the issuer sent), not a different unit. Stripped before the lookup, so
// "KG1" (a real weight — a produce/bakery item priced and sold by the kilo)
// matches "KG" instead of silently falling to "un" with a near-zero quantity
// and a nonsensical per-unit cost (measured 2026-09-27: "PAO FRANCES BOLA
// ASSADO", qCom/qTrib 0.276 "KG1" — R$4.41 total — drafted as 0.276 un at
// R$15.98/un instead of 276 g at R$15,98/kg).
//
// Deliberately narrow — exactly one trailing digit, no decimals — so a unit
// that encodes something else in its suffix (a lone "KG2.5" seen once, likely
// a fixed pack weight, not a code) is left alone rather than guessed at: it
// still falls back to "un", the same as before this fix, not a different,
// silently wrong number.
function internalUnitFor(uTrib: string): { unit: RawIngredientUnit; multiplier: number } {
  const normalized = uTrib.trim().toUpperCase().replace(/\d$/, '');
  return UNIT_TO_INTERNAL[normalized] ?? { unit: 'un', multiplier: 1 };
}

function normalizeForComparison(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tier 2 — dedupe against what the Store already has, before drafting a new
 * record. String containment to start (see docs/features/sefaz-nfe.md); no
 * embedding/LLM comparison, that was scoped out for now. */
function findSimilarRawIngredient<T extends { name: string }>(
  candidateName: string,
  existing: T[],
): T | undefined {
  const candidate = normalizeForComparison(candidateName);
  if (!candidate) return undefined;
  return existing.find((ingredient) => {
    const name = normalizeForComparison(ingredient.name);
    return (
      Boolean(name) && (name === candidate || name.includes(candidate) || candidate.includes(name))
    );
  });
}

// Anything from this size up, written in the product name ("Arroz Pc 5kg"), is
// a bulk ingredient a recipe consumes by weight. Below it ("Hamburguer Pc 56g",
// "Farinha 400g") the pack is a portion or a small retail unit, tracked as
// whole units. Volume in the name (a "200ml" soda, a "1l" bottle) is never
// converted: bottles/cans are sold and counted as units.
const BULK_MASS_MIN_GRAMS = 1000;

// A multi-pack ("cx 12", "c/12", "6 x 350ml", "fardo") makes the number in the
// name ambiguous — is it the box or what is inside it? — so it is left alone.
const MULTI_PACK_PATTERN = /\d\s*[x×]\s*\d|\bc\/\s*\d|\b(?:cx|caixa|fardo|fd)\b/i;
// The lookbehind keeps supplier noise like "...KG UN01UN" from reading as a count.
const COUNT_PATTERN = /(?<![A-Za-z0-9])(\d{2,})\s*(?:uni|und|unid|unidades?|un)\b/i;
const MASS_PATTERN = /(\d[\d.,]*)\s*(kg|gr|g)\b/gi;

/**
 * The pack size the supplier wrote into the description, when it is
 * unambiguous: a count ("OVO 30UNI" -> 30 un) or a bulk weight ("ARROZ 5KG" ->
 * 5000 g). `amount` is how much of the returned unit ONE commercial unit holds.
 */
function packSizeFromDescription(
  description: string,
): { unit: RawIngredientUnit; amount: number } | undefined {
  if (MULTI_PACK_PATTERN.test(description)) return undefined;

  const count = description.match(COUNT_PATTERN);
  // "01" is not a pack size, just a padded 1.
  if (count && Number(count[1]) >= 2) return { unit: 'un', amount: Number(count[1]) };

  // The same weight often appears twice ("5KG UN0-5KG"); only two different
  // weights make the name ambiguous.
  const weights = new Set(
    [...description.matchAll(MASS_PATTERN)].map(([, amount = '0', unit = 'g']) => {
      const value = Number(amount.replace(',', '.'));
      return unit.toLowerCase() === 'kg' ? value * 1000 : value;
    }),
  );
  // A malformed number ("1.000.5kg") is no pack size at all.
  weights.delete(Number.NaN);
  const [grams] = weights;
  if (weights.size !== 1 || grams === undefined) return undefined;
  return grams >= BULK_MASS_MIN_GRAMS ? { unit: 'g', amount: grams } : undefined;
}

/**
 * Tier 1 — no existing SupplierItemMappings for this line: derive a
 * conversion factor straight from the XML (qTrib/qCom, scaled into our g/ml/un
 * unit) instead of leaving the line pending manual entry. See
 * docs/features/sefaz-nfe.md ("Plan: automating capture").
 *
 * When the NFe only says "UN"/"PC" (nothing to scale) the pack size in the
 * name is used instead, so a 5 kg sack is stocked in grams and a tray of 30
 * eggs in eggs, not as "1 un". Only when commercial and tax units agree: a
 * "CX" of "UN" already carries its own factor.
 */
function draftFromItem(item: NfeItem) {
  const { unit, multiplier } = internalUnitFor(item.taxUnit || item.commercialUnit);
  const sameUnit =
    item.commercialUnit.trim().toUpperCase() ===
    (item.taxUnit || item.commercialUnit).trim().toUpperCase();
  const pack = unit === 'un' && sameUnit ? packSizeFromDescription(item.description) : undefined;
  if (pack) {
    return {
      unit: pack.unit,
      conversionFactor: pack.amount,
      convertedQuantity: item.commercialQuantity * pack.amount,
    };
  }

  const rawFactor = item.commercialQuantity > 0 ? item.taxQuantity / item.commercialQuantity : 1;
  const conversionFactor = (rawFactor || 1) * multiplier;
  // The qCom-cancels-out simplification: qCom × conversionFactor === qTrib ×
  // multiplier for THIS line, so crediting straight off qTrib avoids a second
  // rounding pass through the just-derived factor.
  const convertedQuantity = item.taxQuantity * multiplier || item.commercialQuantity * multiplier;
  return { unit, conversionFactor: conversionFactor || 1, convertedQuantity };
}

/**
 * Credits one invoice line to an ingredient, at what it really cost (freight,
 * other expenses and discounts spread in), and writes it to the ledger.
 *
 * The movement goes FIRST: its unique key (invoice + line) is what stops a
 * re-run of a half-applied invoice from crediting the lines it already did. If
 * the credit then fails, the movement is taken back so the retry can apply it.
 */
async function applyPurchase(
  storeId: string,
  invoice: ParsedNfe,
  itemIndex: number,
  item: NfeItem,
  rawIngredientId: string,
  convertedQuantity: number,
): Promise<void> {
  const supplierName = invoice.supplierTradeName || invoice.supplierName;
  const movement = await recordPurchaseMovement({
    storeId,
    rawIngredientId,
    occurredAt: invoice.issuedAt,
    quantity: convertedQuantity,
    unitCost: convertedQuantity > 0 ? roundCost(item.landedValue / convertedQuantity) : 0,
    value: item.landedValue,
    source: {
      invoiceAccessKey: invoice.accessKey,
      invoiceNumber: invoice.number,
      invoiceSeries: invoice.series,
      supplierCnpj: invoice.supplierCnpj,
      supplierName,
      supplierItemCode: item.supplierItemCode,
      description: item.description,
      itemIndex,
    },
  });
  if (movement === 'duplicate') return; // an earlier, interrupted run already credited this line

  try {
    await creditRawIngredientPurchase(rawIngredientId, {
      convertedQuantity,
      lineValue: item.landedValue,
      purchase: {
        at: invoice.issuedAt,
        supplierCnpj: invoice.supplierCnpj,
        supplierName,
        invoiceNumber: invoice.number,
      },
    });
  } catch (err) {
    await deleteMovement(movement.id);
    throw err;
  }
}

async function processItem(
  storeId: string,
  invoice: ParsedNfe,
  itemIndex: number,
  item: NfeItem,
): Promise<'matched' | 'drafted'> {
  const { supplierCnpj } = invoice;
  const existingMapping = await SupplierItemMappingDB.findOne({
    storeId: toObjectId(storeId),
    supplierCnpj,
    supplierItemCode: item.supplierItemCode,
  }).lean<LeanDoc | null>();

  if (existingMapping) {
    const convertedQuantity =
      item.commercialQuantity * Number(existingMapping.conversionFactor ?? 1);
    await applyPurchase(
      storeId,
      invoice,
      itemIndex,
      item,
      String(existingMapping.rawIngredientId),
      convertedQuantity,
    );
    return 'matched';
  }

  const candidateName = cleanIngredientName(item.description) || item.supplierItemCode;
  const { unit, conversionFactor, convertedQuantity } = draftFromItem(item);

  // Tier 2: reuse an existing ingredient with a similar name instead of
  // drafting a duplicate — two suppliers describing the same thing differently.
  const storeIngredients = await RawIngredientDB.find({ storeId: toObjectId(storeId) })
    .select('name')
    .lean<Array<{ _id: unknown; name: string }>>();
  const similar = findSimilarRawIngredient(candidateName, storeIngredients);

  const rawIngredientId = similar
    ? String(similar._id)
    : (
        await createRawIngredientForStore({
          storeId,
          name: candidateName,
          unit,
          isDraft: true,
          kind: suggestIngredientKind(item.description),
        })
      )._id;

  await SupplierItemMappingDB.create({
    storeId: toObjectId(storeId),
    supplierCnpj,
    supplierItemCode: item.supplierItemCode,
    rawIngredientId: toObjectId(rawIngredientId),
    conversionFactor,
  });

  await applyPurchase(storeId, invoice, itemIndex, item, rawIngredientId, convertedQuantity);

  return 'drafted';
}

const PDF_MAGIC = '%PDF-';

/**
 * One file in, one parsed invoice out, XML or PDF. Dispatches on the actual
 * bytes for a base64 file (a `%PDF-` header), not just the `encoding` flag —
 * a wrong flag then fails with the same clear "not a readable PDF" message
 * `parseNfePdf` already gives a corrupt PDF, instead of being handed to the
 * XML parser as raw base64 text and failing with a confusing "not valid XML".
 */
async function parseNfeFile(file: {
  fileName: string;
  content: string;
  encoding?: 'text' | 'base64';
}): Promise<ParsedNfe> {
  if (file.encoding === 'base64') {
    // `unpdf` rejects a Node `Buffer` outright ("provide binary data as
    // `Uint8Array`, rather than `Buffer`"), even though `Buffer` is itself a
    // `Uint8Array` subclass — so this copies out of the decoded buffer into a
    // plain one instead of handing `parseNfePdf` what `Buffer.from` returns.
    const bytes = Uint8Array.from(Buffer.from(file.content, 'base64'));
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== PDF_MAGIC) {
      throw new Error('This file is not a readable PDF.');
    }
    return parseNfePdf(bytes);
  }
  return parseNfeXml(file.content);
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/** Marks the invoice as captured, tolerating a duplicate-key race (a
 * concurrent upload, or the same file submitted twice in one batch) — the
 * stock credit already happened by the time this runs, so that race is not
 * an error here the way the earlier existence check treats it. */
async function recordProcessedInvoice(
  storeId: string,
  parsed: ParsedNfe,
  cancelledAt?: Date,
): Promise<void> {
  try {
    await ProcessedInvoiceDB.create({
      storeId: toObjectId(storeId),
      accessKey: parsed.accessKey,
      issuedAt: parsed.issuedAt,
      totalValue: parsed.totalValue,
      supplierCnpj: parsed.supplierCnpj,
      supplierName: parsed.supplierTradeName || parsed.supplierName,
      number: parsed.number,
      series: parsed.series,
      itemsValue: parsed.itemsValue,
      adjustmentsValue: parsed.adjustmentsValue,
      status: cancelledAt ? 'cancelled' : 'processed',
      cancelledAt,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

/** Every line of one already-parsed, not-yet-processed invoice. */
async function processInvoiceItems(
  storeId: string,
  parsed: ParsedNfe,
): Promise<{ itemsMatched: number; itemsDrafted: number }> {
  let itemsMatched = 0;
  let itemsDrafted = 0;
  for (const [index, item] of parsed.items.entries()) {
    const outcome = await processItem(storeId, parsed, index, item);
    if (outcome === 'matched') itemsMatched += 1;
    else itemsDrafted += 1;
  }
  return { itemsMatched, itemsDrafted };
}

/** Keeps what we were handed (the XML, when it is one) so the Notas screen can show and download it.
 * A failure here is logged and swallowed: the invoice is still read and applied below. */
async function keepNfeDocument(
  storeId: string,
  parsed: ParsedNfe,
  file: { content: string; encoding?: 'text' | 'base64' },
  meta: { source?: 'sefaz' | 'upload'; nsu?: string },
): Promise<void> {
  try {
    await recordNfeFull(storeId, parsed, {
      source: meta.source ?? 'upload',
      nsu: meta.nsu,
      ...(file.encoding !== 'base64' && { xml: file.content }),
    });
  } catch (err) {
    logger.error({ err, storeId, accessKey: parsed.accessKey }, 'could not keep the NFe document');
  }
}

/** Looks for hand-typed purchases this invoice repeats. A failure is logged and swallowed: the
 * invoice is already applied, and the check is advice, not part of capturing it. */
async function flagOverlaps(storeId: string, parsed: ParsedNfe): Promise<void> {
  try {
    await flagManualOverlaps(storeId, parsed.accessKey, parsed.issuedAt);
  } catch (err) {
    logger.error({ err, storeId, accessKey: parsed.accessKey }, 'could not check manual overlaps');
  }
}

/** One file: parse, skip if already captured, apply every line, record the
 * invoice. Split out of `captureNfeFilesForStore` purely to keep that loop
 * flat — this is the part that actually varies per file/error case. */
export async function captureOneFile(
  storeId: string,
  file: { fileName: string; content: string; encoding?: 'text' | 'base64' },
  meta: { source?: 'sefaz' | 'upload'; nsu?: string } = {},
): Promise<NfeCaptureFileResult> {
  try {
    const parsed = await parseNfeFile(file);
    await keepNfeDocument(storeId, parsed, file, meta);

    const alreadyProcessed = await ProcessedInvoiceDB.findOne({
      accessKey: parsed.accessKey,
    }).lean();
    if (alreadyProcessed) {
      return {
        fileName: file.fileName,
        status: 'duplicate',
        accessKey: parsed.accessKey,
        itemsMatched: 0,
        itemsDrafted: 0,
      };
    }

    // An invoice SEFAZ already called cancelled must not credit stock: it is
    // recorded as cancelled and its lines are never applied.
    const cancellation = await findRecordedCancellation(storeId, parsed.accessKey);
    if (cancellation) {
      await recordProcessedInvoice(storeId, parsed, cancellation.cancelledAt);
      return {
        fileName: file.fileName,
        status: 'cancelled',
        accessKey: parsed.accessKey,
        itemsMatched: 0,
        itemsDrafted: 0,
      };
    }

    const { itemsMatched, itemsDrafted } = await processInvoiceItems(storeId, parsed);
    await recordProcessedInvoice(storeId, parsed);
    await flagOverlaps(storeId, parsed);

    return {
      fileName: file.fileName,
      status: 'processed',
      accessKey: parsed.accessKey,
      itemsMatched,
      itemsDrafted,
    };
  } catch (err) {
    return {
      fileName: file.fileName,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
      itemsMatched: 0,
      itemsDrafted: 0,
    };
  }
}

/**
 * Processes one or more NFe files (XML or DANFE PDF) for a Store: idempotent per invoice
 * (`ProcessedInvoices.accessKey`), matches each line against
 * `SupplierItemMappings` when it can, drafts a new `RawIngredient` +
 * mapping when it can't (Tier 1 + Tier 2). Used by both the
 * `sefaz.nfe.received` job and its tests — no queue/job concerns in here.
 */
export async function captureNfeFilesForStore(
  storeId: string,
  files: Array<{ fileName: string; content: string; encoding?: 'text' | 'base64' }>,
): Promise<NfeCaptureSummary> {
  await connectDB();
  const results: NfeCaptureFileResult[] = [];

  for (const file of files) {
    results.push(await captureOneFile(storeId, file));
  }

  return {
    files: results,
    totalItemsMatched: results.reduce((sum, r) => sum + r.itemsMatched, 0),
    totalItemsDrafted: results.reduce((sum, r) => sum + r.itemsDrafted, 0),
  };
}
