/**
 * @jest-environment node
 */
export {};

// Tier 1 (auto-draft) / Tier 2 (dedupe) / idempotency for the manual-upload
// NFe capture — see docs/features/sefaz-nfe.md. Uses the real XML parser
// against fixture XML; only the Mongo models and the raw-ingredients service
// writes are mocked.
const connectDBMock = jest.fn();

const processedInvoiceFindOneMock = jest.fn();
const processedInvoiceCreateMock = jest.fn();

const mappingFindOneMock = jest.fn();
const mappingCreateMock = jest.fn();

const rawIngredientFindMock = jest.fn();

const createRawIngredientForStoreMock = jest.fn();
const recordPurchaseMovementMock = jest.fn();
const deleteMovementMock = jest.fn();
const creditRawIngredientPurchaseMock = jest.fn();
const findRecordedCancellationMock = jest.fn();
const recordNfeFullMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/processed-invoices', () => ({
  __esModule: true,
  default: { findOne: processedInvoiceFindOneMock, create: processedInvoiceCreateMock },
}));
jest.mock('@/app/models/supplier-item-mappings', () => ({
  __esModule: true,
  default: { findOne: mappingFindOneMock, create: mappingCreateMock },
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: rawIngredientFindMock },
}));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordPurchaseMovement: recordPurchaseMovementMock,
  deleteMovement: deleteMovementMock,
}));
jest.mock('@/app/lib/services/nfe-cancellation', () => ({
  findRecordedCancellation: findRecordedCancellationMock,
}));
jest.mock('@/app/lib/services/manual-overlaps', () => ({
  flagManualOverlaps: jest.fn().mockResolvedValue(0),
}));
jest.mock('@/app/lib/services/nfe-documents', () => ({ recordNfeFull: recordNfeFullMock }));
jest.mock('@/app/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('@/app/lib/services/raw-ingredients', () => ({
  createRawIngredientForStore: createRawIngredientForStoreMock,
  creditRawIngredientPurchase: creditRawIngredientPurchaseMock,
}));

// The PDF parser itself is exercised for real in nfe-pdf.spec.ts (it has no
// Mongo/DB concerns) — mocked here so these tests are about the encoding
// dispatch in captureOneFile (base64 -> magic-byte check -> parseNfePdf),
// not about unpdf actually reading a PDF.
const parseNfePdfMock = jest.fn();
jest.mock('@/app/lib/nfe-pdf', () => ({ parseNfePdf: parseNfePdfMock }));

const STORE_ID = '665f735a90788d97f5a76322';
const ACCESS_KEY = '35260912345678000199550010000000011234567890';

function nfeXml(overrides: { chNFe?: string; det?: string } = {}) {
  const det =
    overrides.det ??
    `<det nItem="1"><prod>
      <cProd>SKU-001</cProd>
      <xProd>QUEIJO MUSSARELA FRIBOI 1KG</xProd>
      <uCom>CX</uCom><qCom>1.0000</qCom>
      <uTrib>KG</uTrib><qTrib>12.0000</qTrib>
      <vProd>120.00</vProd>
    </prod></det>`;
  return `<nfeProc><NFe><infNFe Id="NFe${ACCESS_KEY}">
    <ide><dhEmi>2026-09-20T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>12.345.678/0001-99</CNPJ></emit>
    ${det}
    <total><ICMSTot><vNF>120.00</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>${overrides.chNFe ?? ACCESS_KEY}</chNFe></infProt></protNFe>
  </nfeProc>`;
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  findRecordedCancellationMock.mockResolvedValue(null);
  processedInvoiceFindOneMock.mockReturnValue({ lean: () => Promise.resolve(null) });
  processedInvoiceCreateMock.mockResolvedValue({ _id: 'invoice-1' });
  mappingFindOneMock.mockReturnValue({ lean: () => Promise.resolve(null) });
  mappingCreateMock.mockResolvedValue({ _id: 'mapping-1' });
  rawIngredientFindMock.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve([]) }),
  });
  createRawIngredientForStoreMock.mockResolvedValue({ _id: '665f735a90788d97f5a76a01' });
  creditRawIngredientPurchaseMock.mockResolvedValue({ _id: '665f735a90788d97f5a76a01' });
  recordPurchaseMovementMock.mockResolvedValue({ id: 'mv-1' });
  deleteMovementMock.mockResolvedValue(undefined);
});

function packDet(description: string, unit = 'UN', qty = '2.0000') {
  return `<det nItem="1"><prod>
      <cProd>SKU-PACK</cProd>
      <xProd>${description}</xProd>
      <uCom>${unit}</uCom><qCom>${qty}</qCom>
      <uTrib>${unit}</uTrib><qTrib>${qty}</qTrib>
      <vProd>50.00</vProd>
    </prod></det>`;
}

describe('draft unit from the pack size in the product name', () => {
  async function draft(description: string, unit?: string) {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');
    await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'nota.xml', content: nfeXml({ det: packDet(description, unit) }) },
    ]);
    return {
      created: createRawIngredientForStoreMock.mock.calls[0]?.[0],
      mapping: mappingCreateMock.mock.calls[0]?.[0],
      credit: creditRawIngredientPurchaseMock.mock.calls[0]?.[1],
    };
  }

  it('turns a bulk weight in the name into grams (5 kg sack x 2 = 10000 g)', async () => {
    const { created, mapping, credit } = await draft('ARROZ DONA XEPA T1 PC 5KG');

    expect(created).toMatchObject({ unit: 'g' });
    expect(mapping).toMatchObject({ conversionFactor: 5000 });
    expect(credit).toMatchObject({ convertedQuantity: 10000, lineValue: 50 });
  });

  it('reads a decimal comma ("2,2kg")', async () => {
    const { mapping } = await draft('DET PO MINUANO AZUL 2,2KG UN');

    expect(mapping).toMatchObject({ conversionFactor: 2200 });
  });

  it('ignores the supplier "UN01UN" suffix and reads the weight before it', async () => {
    const { created, mapping } = await draft('MAIONESE HELLMANNS BAG 2,8KG UN01UN');

    expect(created).toMatchObject({ unit: 'g' });
    expect(mapping).toMatchObject({ conversionFactor: 2800 });
  });

  it('accepts the same weight written twice', async () => {
    const { mapping } = await draft('ACUCAR CRISTAL PEROLA 5KG UN0-5KG');

    expect(mapping).toMatchObject({ conversionFactor: 5000 });
  });

  it('turns a count in the name into units (a tray of 30 eggs x 2 = 60 un)', async () => {
    const { created, mapping, credit } = await draft('OVO 30UNI LOYOLA BCO');

    expect(created).toMatchObject({ unit: 'un' });
    expect(mapping).toMatchObject({ conversionFactor: 30 });
    expect(credit).toMatchObject({ convertedQuantity: 60, lineValue: 50 });
  });

  it.each([
    ['a small retail weight', 'HAMBURGUER AURORA FAROESTE PC 56G'],
    ['a volume (bottles are counted, not poured)', 'REFRI COCA COLA PET 2L'],
    ['a multi-pack', 'REFRI FANTA LARANJA 6 X 350ML CX'],
    ['two weights (ambiguous)', 'ARROZ 5KG PC 1KG'],
    ['a "1 Un" unit suffix', 'AGUA SANITARIA ZUPP 1L UN'],
  ])('keeps whole units for %s', async (_label, description) => {
    const { created, mapping, credit } = await draft(description);

    expect(created).toMatchObject({ unit: 'un' });
    expect(mapping).toMatchObject({ conversionFactor: 1 });
    expect(credit).toMatchObject({ convertedQuantity: 2, lineValue: 50 });
  });

  it('does not use the name when the commercial unit differs from the tax unit', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');
    const det = `<det nItem="1"><prod>
      <cProd>SKU-CX</cProd><xProd>ARROZ 5KG</xProd>
      <uCom>CX</uCom><qCom>1.0000</qCom>
      <uTrib>UN</uTrib><qTrib>6.0000</qTrib>
      <vProd>50.00</vProd>
    </prod></det>`;

    await captureNfeFilesForStore(STORE_ID, [{ fileName: 'n.xml', content: nfeXml({ det }) }]);

    expect(createRawIngredientForStoreMock.mock.calls[0][0]).toMatchObject({ unit: 'un' });
    expect(mappingCreateMock.mock.calls[0][0]).toMatchObject({ conversionFactor: 6 });
  });
});

describe('captureNfeFilesForStore', () => {
  it('skips an invoice already captured before (idempotency)', async () => {
    processedInvoiceFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ _id: 'existing' }),
    });
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'nota.xml', content: nfeXml() },
    ]);

    expect(summary.files[0]).toMatchObject({ status: 'duplicate', accessKey: ACCESS_KEY });
    expect(mappingFindOneMock).not.toHaveBeenCalled();
    expect(processedInvoiceCreateMock).not.toHaveBeenCalled();
  });

  it('keeps the XML it was handed, with where it came from', async () => {
    processedInvoiceFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ _id: 'existing' }),
    });
    const { captureOneFile } = await import('@/app/lib/services/nfe-capture');
    const content = nfeXml();

    await captureOneFile(
      STORE_ID,
      { fileName: 'NSU-7.xml', content },
      { source: 'sefaz', nsu: '7' },
    );

    expect(recordNfeFullMock).toHaveBeenCalledWith(
      STORE_ID,
      expect.objectContaining({ accessKey: ACCESS_KEY }),
      { source: 'sefaz', nsu: '7', xml: content },
    );
  });

  it('defaults to an upload and keeps no XML for a base64 (DANFE PDF) file', async () => {
    processedInvoiceFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ _id: 'existing' }),
    });
    parseNfePdfMock.mockResolvedValue({
      accessKey: ACCESS_KEY,
      issuedAt: new Date('2026-09-20T13:00:00.000Z'),
      totalValue: 10,
      supplierCnpj: '12345678000199',
      supplierName: 'X',
      itemsValue: 10,
      adjustmentsValue: 0,
      items: [],
    });
    const { captureOneFile } = await import('@/app/lib/services/nfe-capture');
    const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');

    await captureOneFile(STORE_ID, { fileName: 'nota.pdf', content: pdf, encoding: 'base64' });

    expect(recordNfeFullMock).toHaveBeenCalledWith(STORE_ID, expect.anything(), {
      source: 'upload',
      nsu: undefined,
    });
  });

  it('still captures the invoice when keeping the XML fails', async () => {
    recordNfeFullMock.mockRejectedValueOnce(new Error('db down'));
    processedInvoiceFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ _id: 'existing' }),
    });
    const { captureOneFile } = await import('@/app/lib/services/nfe-capture');

    const result = await captureOneFile(STORE_ID, { fileName: 'nota.xml', content: nfeXml() });

    expect(result).toMatchObject({ status: 'duplicate', accessKey: ACCESS_KEY });
  });

  it('records an invoice SEFAZ already called cancelled, without crediting any stock', async () => {
    const cancelledAt = new Date('2026-09-20T13:00:00.000Z');
    findRecordedCancellationMock.mockResolvedValue({ cancelledAt });
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'nota.xml', content: nfeXml() },
    ]);

    expect(summary.files[0]).toMatchObject({ status: 'cancelled', accessKey: ACCESS_KEY });
    expect(processedInvoiceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessKey: ACCESS_KEY, status: 'cancelled', cancelledAt }),
    );
    expect(mappingFindOneMock).not.toHaveBeenCalled();
    expect(recordPurchaseMovementMock).not.toHaveBeenCalled();
    expect(creditRawIngredientPurchaseMock).not.toHaveBeenCalled();
  });

  it('credits an existing mapping (matched) using its stored conversion factor', async () => {
    mappingFindOneMock.mockReturnValue({
      lean: () =>
        Promise.resolve({
          rawIngredientId: 'ingredient-existing',
          conversionFactor: 12,
        }),
    });
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'nota.xml', content: nfeXml() },
    ]);

    expect(creditRawIngredientPurchaseMock).toHaveBeenCalledWith(
      'ingredient-existing',
      expect.objectContaining({
        convertedQuantity: 12, // qCom (1) * conversionFactor (12)
        lineValue: 120,
      }),
    );
    expect(createRawIngredientForStoreMock).not.toHaveBeenCalled();
    expect(summary.files[0]).toMatchObject({
      status: 'processed',
      itemsMatched: 1,
      itemsDrafted: 0,
    });
    expect(processedInvoiceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessKey: ACCESS_KEY, status: 'processed' }),
    );
  });

  it('Tier 1: drafts a new ingredient + mapping when nothing matches, converting KG to grams', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'nota.xml', content: nfeXml() },
    ]);

    expect(createRawIngredientForStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE_ID,
        name: 'Queijo Mussarela Friboi 1kg',
        unit: 'g',
        isDraft: true,
      }),
    );
    // qTrib (12) in KG -> 12000 g; qCom cancels out in the stored factor too.
    expect(mappingCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversionFactor: 12000 }),
    );
    expect(creditRawIngredientPurchaseMock).toHaveBeenCalledWith(
      '665f735a90788d97f5a76a01',
      expect.objectContaining({ convertedQuantity: 12000, lineValue: 120 }),
    );
    expect(summary.files[0]).toMatchObject({ itemsMatched: 0, itemsDrafted: 1 });
  });

  // A real bug (2026-09-27): some suppliers append one internal digit to the
  // unit code ("KG1", "UND9"...). A weighed item invoiced as "KG1" fell to the
  // "un" default and was drafted at a near-zero quantity and an absurd
  // per-unit cost — a pão francês invoiced as 0,276 "KG1" for R$4,41 (i.e.
  // R$15,98/kg) came out as 0,276 un at R$15,98/un.
  it.each([
    ['KG1', 'g', 1000],
    ['UN1', 'un', 1],
    ['UND9', 'un', 1],
    ['PCT9', 'un', 1],
  ] as const)(
    'reads the real unit under a supplier-appended digit ("%s")',
    async (code, unit, multiplier) => {
      const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

      await captureNfeFilesForStore(STORE_ID, [
        {
          fileName: 'n.xml',
          content: nfeXml({ det: packDet('PAO FRANCES BOLA ASSADO', code, '0.2760') }),
        },
      ]);

      expect(createRawIngredientForStoreMock).toHaveBeenCalledWith(
        expect.objectContaining({ unit }),
      );
      // qCom cancels out (same value as qTrib here), so the stored factor is just the multiplier.
      expect(mappingCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversionFactor: multiplier }),
      );
      expect(creditRawIngredientPurchaseMock).toHaveBeenCalledWith(
        '665f735a90788d97f5a76a01',
        expect.objectContaining({ convertedQuantity: 0.276 * multiplier }),
      );
    },
  );

  it('does not guess at a unit that encodes something other than a trailing digit ("KG2.5" stays un)', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [
      {
        fileName: 'n.xml',
        content: nfeXml({ det: packDet('LING CALABRESA PERDIGAO', 'KG2.5', '1.0000') }),
      },
    ]);

    expect(createRawIngredientForStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'un' }),
    );
  });

  it('Tier 2: reuses a similarly-named existing ingredient instead of drafting a duplicate', async () => {
    rawIngredientFindMock.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([{ _id: '665f735a90788d97f5a76a02', name: 'Queijo Mussarela' }]),
      }),
    });
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [{ fileName: 'nota.xml', content: nfeXml() }]);

    expect(createRawIngredientForStoreMock).not.toHaveBeenCalled();
    expect(mappingCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ rawIngredientId: expect.anything() }),
    );
    expect(creditRawIngredientPurchaseMock).toHaveBeenCalledWith(
      '665f735a90788d97f5a76a02',
      expect.any(Object),
    );
  });

  it('isolates a bad file from the rest of the batch instead of throwing', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'bad.xml', content: 'not xml <<<' },
      { fileName: 'good.xml', content: nfeXml() },
    ]);

    expect(summary.files[0]).toMatchObject({ fileName: 'bad.xml', status: 'error' });
    expect(summary.files[1]).toMatchObject({ fileName: 'good.xml', status: 'processed' });
  });

  describe('encoding dispatch (a file may be an XML or a DANFE PDF)', () => {
    const PDF_ACCESS_KEY = '35260911222333000181550010000001231000000013';

    function parsedPdfInvoice() {
      return {
        accessKey: PDF_ACCESS_KEY,
        issuedAt: new Date('2026-09-20T12:00:00'),
        totalValue: 100,
        supplierCnpj: '11222333000181',
        supplierName: 'FORNECEDOR TESTE LTDA',
        number: '123',
        series: '1',
        itemsValue: 100,
        adjustmentsValue: 0,
        items: [
          {
            supplierItemCode: 'item-teste',
            description: 'ITEM TESTE',
            commercialUnit: 'UN',
            commercialQuantity: 10,
            taxUnit: 'UN',
            taxQuantity: 10,
            totalValue: 100,
            landedValue: 100,
          },
        ],
      };
    }

    it('treats a file with no encoding field as XML (back-compat with older payloads)', async () => {
      const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

      const summary = await captureNfeFilesForStore(STORE_ID, [
        { fileName: 'nota.xml', content: nfeXml() },
      ]);

      expect(parseNfePdfMock).not.toHaveBeenCalled();
      expect(summary.files[0]).toMatchObject({ status: 'processed', accessKey: ACCESS_KEY });
    });

    it('decodes a base64 file and hands its bytes to the PDF parser', async () => {
      parseNfePdfMock.mockResolvedValue(parsedPdfInvoice());
      const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

      const content = Buffer.from('%PDF-1.4 fake danfe bytes').toString('base64');
      const summary = await captureNfeFilesForStore(STORE_ID, [
        { fileName: 'nota.pdf', content, encoding: 'base64' },
      ]);

      expect(parseNfePdfMock).toHaveBeenCalledTimes(1);
      const bytesArg = parseNfePdfMock.mock.calls[0]![0] as Uint8Array;
      expect(Buffer.from(bytesArg).toString('latin1')).toBe('%PDF-1.4 fake danfe bytes');
      expect(summary.files[0]).toMatchObject({
        status: 'processed',
        accessKey: PDF_ACCESS_KEY,
        itemsDrafted: 1,
      });
      expect(createRawIngredientForStoreMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Item Teste' }),
      );
    });

    it('rejects a base64 file that is not actually a PDF, without calling the PDF parser', async () => {
      const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

      const content = Buffer.from('this is not a pdf').toString('base64');
      const summary = await captureNfeFilesForStore(STORE_ID, [
        { fileName: 'nota.pdf', content, encoding: 'base64' },
      ]);

      expect(parseNfePdfMock).not.toHaveBeenCalled();
      expect(summary.files[0]).toMatchObject({
        status: 'error',
        error: 'This file is not a readable PDF.',
      });
    });
  });
});

// What the NFe says about who sold it and when, the cost the line really had,
// and the ledger that makes a re-run safe.
function richXml(extra: { supplier?: string; det?: string; vNF?: string } = {}) {
  return nfeXml({ det: extra.det })
    .replace(
      '<emit><CNPJ>12.345.678/0001-99</CNPJ></emit>',
      extra.supplier ??
        '<emit><CNPJ>12345678000199</CNPJ><xNome>COSTA MULTICANAL S/A</xNome><xFant>LOJA SANTA MARIA</xFant></emit>',
    )
    .replace('<ide><dhEmi>', '<ide><nNF>30892</nNF><serie>1</serie><dhEmi>')
    .replace('<vNF>120.00</vNF>', `<vNF>${extra.vNF ?? '120.00'}</vNF>`);
}

describe('the purchase ledger', () => {
  const movement = () => recordPurchaseMovementMock.mock.calls[0]?.[0];

  it('records the movement with the supplier, invoice and date, BEFORE crediting the stock', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [{ fileName: 'n.xml', content: richXml() }]);

    expect(movement()).toMatchObject({
      storeId: STORE_ID,
      quantity: 12000,
      value: 120,
      unitCost: 0.01,
      source: {
        invoiceAccessKey: ACCESS_KEY,
        invoiceNumber: '30892',
        invoiceSeries: '1',
        supplierCnpj: '12345678000199',
        supplierName: 'LOJA SANTA MARIA', // the trade name, what people call it
        supplierItemCode: 'SKU-001',
        itemIndex: 0,
      },
    });
    expect(movement().occurredAt.toISOString()).toBe('2026-09-20T13:00:00.000Z');
    expect(recordPurchaseMovementMock.mock.invocationCallOrder[0]).toBeLessThan(
      creditRawIngredientPurchaseMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('puts the supplier and invoice on the ingredient as its last purchase', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [{ fileName: 'n.xml', content: richXml() }]);

    expect(creditRawIngredientPurchaseMock.mock.calls[0]?.[1].purchase).toMatchObject({
      supplierCnpj: '12345678000199',
      supplierName: 'LOJA SANTA MARIA',
      invoiceNumber: '30892',
    });
  });

  it('falls back to the legal name when the supplier has no trade name', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');
    const supplier = '<emit><CNPJ>12345678000199</CNPJ><xNome>BRF S.A.</xNome></emit>';

    await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: richXml({ supplier }) },
    ]);

    expect(movement().source.supplierName).toBe('BRF S.A.');
  });

  it('costs the line at what it really cost: freight spread in (120 + 12 = 132)', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: richXml({ vNF: '132.00' }) },
    ]);

    expect(creditRawIngredientPurchaseMock.mock.calls[0]?.[1].lineValue).toBe(132);
    expect(movement()).toMatchObject({ value: 132, unitCost: 0.011 });
  });

  it('does not credit a line an earlier, interrupted run already applied', async () => {
    recordPurchaseMovementMock.mockResolvedValue('duplicate');
    mappingFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ rawIngredientId: 'ing-1', conversionFactor: 12 }),
    });
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: richXml() },
    ]);

    expect(creditRawIngredientPurchaseMock).not.toHaveBeenCalled();
    expect(summary.files[0]).toMatchObject({ status: 'processed', itemsMatched: 1 });
  });

  it('takes the movement back when the credit fails, so a retry can apply the line', async () => {
    mappingFindOneMock.mockReturnValue({
      lean: () => Promise.resolve({ rawIngredientId: 'ing-1', conversionFactor: 12 }),
    });
    creditRawIngredientPurchaseMock.mockRejectedValue(new Error('mongo went away'));
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    const summary = await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: richXml() },
    ]);

    expect(deleteMovementMock).toHaveBeenCalledWith('mv-1');
    expect(summary.files[0]).toMatchObject({ status: 'error', error: 'mongo went away' });
    expect(processedInvoiceCreateMock).not.toHaveBeenCalled();
  });

  it('numbers the lines of an invoice so each one is idempotent on its own', async () => {
    const det = `<det nItem="1"><prod><cProd>A</cProd><xProd>ITEM A</xProd><uCom>UN</uCom><qCom>1</qCom><uTrib>UN</uTrib><qTrib>1</qTrib><vProd>60.00</vProd></prod></det>
      <det nItem="2"><prod><cProd>B</cProd><xProd>ITEM B</xProd><uCom>UN</uCom><qCom>1</qCom><uTrib>UN</uTrib><qTrib>1</qTrib><vProd>60.00</vProd></prod></det>`;
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [{ fileName: 'n.xml', content: richXml({ det }) }]);

    expect(recordPurchaseMovementMock.mock.calls.map((call) => call[0].source.itemIndex)).toEqual([
      0, 1,
    ]);
  });

  it('records who sold the invoice on the processed invoice', async () => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');

    await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: richXml({ vNF: '132.00' }) },
    ]);

    expect(processedInvoiceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCnpj: '12345678000199',
        supplierName: 'LOJA SANTA MARIA',
        number: '30892',
        series: '1',
        itemsValue: 120,
        adjustmentsValue: 12,
      }),
    );
  });
});

describe('drafting: name and kind', () => {
  const draftOf = async (description: string) => {
    const { captureNfeFilesForStore } = await import('@/app/lib/services/nfe-capture');
    await captureNfeFilesForStore(STORE_ID, [
      { fileName: 'n.xml', content: nfeXml({ det: packDet(description) }) },
    ]);
    return createRawIngredientForStoreMock.mock.calls[0]?.[0];
  };

  it('drops the supplier unit suffix from the name', async () => {
    expect((await draftOf('ACUCAR CRISTAL PEROLA 5KG UN0-5KG')).name).toBe(
      'Acucar Cristal Perola 5kg',
    );
  });

  it.each([
    ['LIMP VEJA COZINHA 400ML RF LARANJA UN', 'cleaning'],
    ['GUARDANAPO SANTEPEL 33X30CM 50UN UN01UN', 'packaging'],
    ['LUVA BOMPACK LATEX AMARELA M UN', 'other'],
    ['QUEIJO MUSSARELA FATIADO 1KG', 'food'],
  ])('suggests the kind of "%s": %s', async (description, kind) => {
    expect((await draftOf(description)).kind).toBe(kind);
  });
});
