import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import type { NfeSummary, ParsedNfe } from '@/app/lib/nfe-xml';
import { totalPages } from '@/app/lib/pagination';
import { containsCondition } from '@/app/lib/search-regex';
import JobsDB from '@/app/models/jobs';
import NfeDocumentDB from '@/app/models/nfe-documents';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';

// The Notas screen: every NFe we hold something of — only the preview (`resNFe`, no items, nothing
// applied to stock) or the full note — and the XML of the ones that came as XML.
//
// `processed_invoices` stays the guard of what was applied to stock; this reads it only to say what
// became of a note ("captured", "cancelled"), never to decide it.

export type NfeNoteFilter = 'all' | 'preview' | 'full' | 'cancelled';

/** What became of the note on our side. */
export type NfeNoteStatus = 'preview' | 'captured' | 'cancelled' | 'ignored' | 'unprocessed';

export type NfeNoteRow = {
  accessKey: string;
  issuedAt: string;
  supplierName: string;
  supplierCnpj: string;
  number?: string;
  series?: string;
  totalValue: number;
  /** Σ of the item lines and what the total adds on top; only known once the items were read. */
  itemsValue?: number;
  adjustmentsValue?: number;
  /** 'summary': only the preview; 'full': the whole note was read. */
  level: 'summary' | 'full';
  status: NfeNoteStatus;
  hasXml: boolean;
  source: 'sefaz' | 'upload';
  /** Hand-typed purchases this note seems to repeat and nobody answered about yet. */
  openOverlaps: Array<{
    movementId: string;
    ingredientName: string;
    unit: 'g' | 'ml' | 'un';
    supplierName: string;
    occurredAt: string;
    quantity: number;
    value: number;
  }>;
};

export type NfeNotesPage = {
  data: NfeNoteRow[];
  total: number;
  page: number;
  totalPages: number;
};

export type NfeNotesSummary = { total: number; previews: number; captured: number };

type DocumentDoc = LeanDoc & {
  accessKey: string;
  level: 'summary' | 'full';
  supplierCnpj?: string;
  supplierName?: string;
  number?: string;
  series?: string;
  issuedAt: Date;
  totalValue: number;
  source: 'sefaz' | 'upload';
  hasXml?: boolean;
};

type InvoiceDoc = LeanDoc & {
  accessKey: string;
  status: 'processed' | 'ignored' | 'cancelled';
  itemsValue?: number;
  adjustmentsValue?: number;
  manualOverlaps?: Array<{
    movementId: unknown;
    ingredientName?: string;
    unit?: 'g' | 'ml' | 'un';
    supplierName?: string;
    occurredAt?: Date;
    quantity?: number;
    value?: number;
    status: string;
  }>;
};

const LIST_FIELDS =
  'accessKey level supplierCnpj supplierName number series issuedAt totalValue source hasXml';

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/**
 * Remembers that SEFAZ announced a note. Never downgrades: a note we already hold in full keeps
 * its XML, and a summary seen twice stays as the first one.
 */
export async function recordNfeSummary(
  storeId: string,
  summary: NfeSummary,
  meta: { nsu?: string } = {},
): Promise<void> {
  await connectDB();
  try {
    await NfeDocumentDB.updateOne(
      { storeId: toObjectId(storeId), accessKey: summary.accessKey },
      {
        $setOnInsert: {
          level: 'summary',
          supplierCnpj: summary.supplierCnpj,
          supplierName: summary.supplierName,
          issuedAt: summary.issuedAt,
          totalValue: summary.totalValue,
          source: 'sefaz',
          nsu: meta.nsu,
          hasXml: false,
          summaryAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    // Two runs announcing the same note at once: the other one wrote it, which is all we wanted.
    if (!isDuplicateKeyError(err)) throw err;
  }
}

/**
 * Remembers that the whole note was read, with its XML when it came as XML (a DANFE PDF has none,
 * and must not erase an XML we already hold).
 */
export async function recordNfeFull(
  storeId: string,
  parsed: ParsedNfe,
  input: { xml?: string; source: 'sefaz' | 'upload'; nsu?: string },
): Promise<void> {
  await connectDB();
  const now = new Date();
  try {
    await NfeDocumentDB.updateOne(
      { storeId: toObjectId(storeId), accessKey: parsed.accessKey },
      {
        $set: {
          level: 'full',
          supplierCnpj: parsed.supplierCnpj,
          supplierName: parsed.supplierTradeName || parsed.supplierName,
          number: parsed.number,
          series: parsed.series,
          issuedAt: parsed.issuedAt,
          totalValue: parsed.totalValue,
          fullAt: now,
          ...(input.xml !== undefined && { xml: input.xml, hasXml: true }),
          ...(input.nsu !== undefined && { nsu: input.nsu }),
        },
        // `source` says where the note first came from; an upload of a note SEFAZ announced does not rewrite it.
        $setOnInsert: { source: input.source },
      },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

async function cancelledKeys(storeId: string): Promise<string[]> {
  const rows = await ProcessedInvoiceDB.find({ storeId: toObjectId(storeId), status: 'cancelled' })
    .select('accessKey')
    .lean<Array<{ accessKey: string }>>();
  return rows.map((row) => row.accessKey);
}

async function buildQuery(
  storeId: string,
  params: { q?: string; filter?: NfeNoteFilter },
): Promise<Record<string, unknown>> {
  const term = params.q?.trim();
  const filter = params.filter ?? 'all';
  return {
    storeId: toObjectId(storeId),
    ...(filter === 'preview' && { level: 'summary' }),
    ...(filter === 'full' && { level: 'full' }),
    ...(filter === 'cancelled' && { accessKey: { $in: await cancelledKeys(storeId) } }),
    // The supplier's name, the invoice number, or any part of the 44-digit key.
    ...(term && {
      $or: [
        { supplierName: containsCondition(term) },
        { number: term.replace(/^0+/, '') || term },
        ...(/^\d{6,}$/.test(term) ? [{ accessKey: containsCondition(term) }] : []),
      ],
    }),
  };
}

function statusOf(doc: DocumentDoc, invoice?: InvoiceDoc): NfeNoteStatus {
  if (invoice) return invoice.status === 'processed' ? 'captured' : invoice.status;
  return doc.level === 'summary' ? 'preview' : 'unprocessed';
}

/** One page of a store's notes, newest issue date first. */
export async function getNfeNotesPageForStore(
  storeId: string,
  params: { page?: number; limit?: number; q?: string; filter?: NfeNoteFilter } = {},
): Promise<NfeNotesPage> {
  await connectDB();
  const page = Math.max(1, params.page ?? 1);
  const limit = params.limit ?? 20;
  const query = await buildQuery(storeId, params);

  const [docs, total] = await Promise.all([
    NfeDocumentDB.find(query)
      .select(LIST_FIELDS)
      .sort({ issuedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<DocumentDoc[]>(),
    NfeDocumentDB.countDocuments(query),
  ]);

  const invoices = await ProcessedInvoiceDB.find({
    storeId: toObjectId(storeId),
    accessKey: { $in: docs.map((doc) => doc.accessKey) },
  })
    .select('accessKey status itemsValue adjustmentsValue manualOverlaps')
    .lean<InvoiceDoc[]>();
  const byKey = new Map(invoices.map((invoice) => [invoice.accessKey, invoice]));

  return {
    data: docs.map((doc) => {
      const invoice = byKey.get(doc.accessKey);
      return {
        accessKey: doc.accessKey,
        issuedAt: doc.issuedAt.toISOString(),
        supplierName: doc.supplierName ?? '',
        supplierCnpj: doc.supplierCnpj ?? '',
        number: doc.number,
        series: doc.series,
        totalValue: Number(doc.totalValue ?? 0),
        itemsValue: invoice?.itemsValue,
        adjustmentsValue: invoice?.adjustmentsValue,
        level: doc.level,
        status: statusOf(doc, invoice),
        hasXml: doc.hasXml === true,
        source: doc.source,
        openOverlaps: (invoice?.manualOverlaps ?? [])
          .filter((overlap) => overlap.status === 'open')
          .map((overlap) => ({
            movementId: String(overlap.movementId),
            ingredientName: overlap.ingredientName ?? '',
            unit: overlap.unit ?? 'un',
            supplierName: overlap.supplierName ?? '',
            occurredAt: overlap.occurredAt ? overlap.occurredAt.toISOString() : '',
            quantity: Number(overlap.quantity ?? 0),
            value: Number(overlap.value ?? 0),
          })),
      };
    }),
    total,
    page,
    totalPages: totalPages(total, limit),
  };
}

/** The three numbers above the table. */
export async function getNfeNotesSummaryForStore(storeId: string): Promise<NfeNotesSummary> {
  await connectDB();
  const scope = { storeId: toObjectId(storeId) };
  const [total, previews] = await Promise.all([
    NfeDocumentDB.countDocuments(scope),
    NfeDocumentDB.countDocuments({ ...scope, level: 'summary' }),
  ]);
  return { total, previews, captured: total - previews };
}

/** The stored XML of one note, scoped to the store; `null` when we hold none (a preview, a PDF). */
export async function getNfeXmlForStore(
  storeId: string,
  accessKey: string,
): Promise<string | null> {
  await connectDB();
  const doc = await NfeDocumentDB.findOne({ storeId: toObjectId(storeId), accessKey, hasXml: true })
    .select('+xml')
    .lean<{ xml?: string } | null>();
  return doc?.xml ?? null;
}

/** What the Jobs screen shows about one XML we hand out; `null` when we hold none. */
export async function describeNfeXmlExport(
  storeId: string,
  accessKey: string,
): Promise<{ storeId: string; accessKey: string; fileName: string; bytes: number } | null> {
  const xml = await getNfeXmlForStore(storeId, accessKey);
  if (xml === null) return null;
  return {
    storeId,
    accessKey,
    fileName: `NFe${accessKey}.xml`,
    bytes: Buffer.byteLength(xml, 'utf8'),
  };
}

/**
 * Registers the XML download as a finished `nfe.xml.export` job, so it shows up in Sistema > Jobs
 * next to the other exports. The download itself is immediate (a few KB, nothing to wait for), so
 * the row is written already `done` instead of going through the queue.
 */
export async function recordNfeXmlExport(input: {
  organizationId: string;
  storeId: string;
  accessKey: string;
  requestedByUserId: string;
  summary: { fileName: string; bytes: number };
}): Promise<void> {
  await connectDB();
  const payload = {
    requestedByUserId: input.requestedByUserId,
    storeId: input.storeId,
    accessKey: input.accessKey,
  };
  await JobsDB.create({
    kind: 'nfe.xml.export',
    handler: 'nfe.xml.export',
    payload,
    status: 'done',
    type: 'AdHoc',
    examId: `NFE-XML-${input.accessKey}-${Date.now()}`,
    organizationId: toObjectId(input.organizationId),
    params: { payloadOriginal: payload, userLoggedId: input.requestedByUserId },
    result: {
      kind: 'nfe.xml.export',
      ...input.summary,
      storeId: input.storeId,
      accessKey: input.accessKey,
      completedAt: new Date().toISOString(),
    },
  });
}
