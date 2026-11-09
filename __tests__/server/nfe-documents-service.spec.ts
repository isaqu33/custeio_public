/**
 * @jest-environment node
 */
export {};

// The Notas screen's data layer: what we hold of each NFe (preview or full) and its XML.
const connectDBMock = jest.fn();
const updateOneMock = jest.fn();
const findMock = jest.fn();
const findSelectMock = jest.fn();
const findSortMock = jest.fn();
const skipMock = jest.fn();
const limitMock = jest.fn();
const findLeanMock = jest.fn();
const countDocumentsMock = jest.fn();
const findOneMock = jest.fn();
const findOneSelectMock = jest.fn();
const findOneLeanMock = jest.fn();
const invoiceFindMock = jest.fn();
const invoiceSelectMock = jest.fn();
const invoiceLeanMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/nfe-documents', () => ({
  __esModule: true,
  default: {
    updateOne: updateOneMock,
    find: findMock,
    countDocuments: countDocumentsMock,
    findOne: findOneMock,
  },
}));
jest.mock('@/app/models/processed-invoices', () => ({
  __esModule: true,
  default: { find: invoiceFindMock },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const KEY_A = '53261081611931002252550030012040341199141519';
const KEY_B = '35260912345678000199550010000000011234567890';

const doc = (over = {}) => ({
  accessKey: KEY_A,
  level: 'full',
  supplierName: 'OESA',
  supplierCnpj: '81611931002252',
  number: '1204034',
  series: '3',
  issuedAt: new Date('2026-10-06T06:38:00.000Z'),
  totalValue: 1100.73,
  source: 'sefaz',
  hasXml: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  findMock.mockReturnValue({ select: findSelectMock });
  findSelectMock.mockReturnValue({ sort: findSortMock });
  findSortMock.mockReturnValue({ skip: skipMock });
  skipMock.mockReturnValue({ limit: limitMock });
  limitMock.mockReturnValue({ lean: findLeanMock });
  findLeanMock.mockResolvedValue([doc()]);
  countDocumentsMock.mockResolvedValue(1);
  invoiceFindMock.mockReturnValue({ select: invoiceSelectMock });
  invoiceSelectMock.mockReturnValue({ lean: invoiceLeanMock });
  invoiceLeanMock.mockResolvedValue([]);
  findOneMock.mockReturnValue({ select: findOneSelectMock });
  findOneSelectMock.mockReturnValue({ lean: findOneLeanMock });
});

const summary = {
  accessKey: KEY_A,
  issuedAt: new Date('2026-10-06T06:38:00.000Z'),
  totalValue: 1100.73,
  supplierCnpj: '81611931002252',
  supplierName: 'OESA',
};

describe('recordNfeSummary', () => {
  it('only inserts: a note already held (maybe in full) is never downgraded', async () => {
    const { recordNfeSummary } = await import('@/app/lib/services/nfe-documents');

    await recordNfeSummary(STORE_ID, summary, { nsu: '000000000000323' });

    const [filter, update, options] = updateOneMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ accessKey: KEY_A });
    expect(update).toEqual({
      $setOnInsert: expect.objectContaining({ level: 'summary', hasXml: false, source: 'sefaz' }),
    });
    expect(update).not.toHaveProperty('$set');
    expect(options).toEqual({ upsert: true });
  });

  it('tolerates the duplicate-key race of two runs announcing the same note', async () => {
    updateOneMock.mockRejectedValueOnce({ code: 11000 });
    const { recordNfeSummary } = await import('@/app/lib/services/nfe-documents');

    await expect(recordNfeSummary(STORE_ID, summary)).resolves.toBeUndefined();
  });

  it('does not swallow any other failure', async () => {
    updateOneMock.mockRejectedValueOnce(new Error('db down'));
    const { recordNfeSummary } = await import('@/app/lib/services/nfe-documents');

    await expect(recordNfeSummary(STORE_ID, summary)).rejects.toThrow('db down');
  });
});

describe('recordNfeFull', () => {
  const parsed = {
    ...summary,
    number: '1204034',
    series: '3',
    supplierTradeName: 'OESA FANTASIA',
    itemsValue: 1100.73,
    adjustmentsValue: 0,
    items: [],
  };

  it('upgrades to full and keeps the XML it was given', async () => {
    const { recordNfeFull } = await import('@/app/lib/services/nfe-documents');

    await recordNfeFull(STORE_ID, parsed, { xml: '<nfeProc/>', source: 'sefaz', nsu: '325' });

    const [, update] = updateOneMock.mock.calls[0] as [unknown, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(update.$set).toMatchObject({
      level: 'full',
      supplierName: 'OESA FANTASIA',
      xml: '<nfeProc/>',
      hasXml: true,
      nsu: '325',
    });
    expect(update.$setOnInsert).toEqual({ source: 'sefaz' });
  });

  it('never erases an XML already held when the file has none (a PDF)', async () => {
    const { recordNfeFull } = await import('@/app/lib/services/nfe-documents');

    await recordNfeFull(STORE_ID, parsed, { source: 'upload' });

    const [, update] = updateOneMock.mock.calls[0] as [unknown, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(update.$set).not.toHaveProperty('xml');
    expect(update.$set).not.toHaveProperty('hasXml');
  });
});

describe('getNfeNotesPageForStore', () => {
  it('lists newest issue date first, scoped to the store', async () => {
    const { getNfeNotesPageForStore } = await import('@/app/lib/services/nfe-documents');

    const page = await getNfeNotesPageForStore(STORE_ID, { page: 2, limit: 10 });

    expect(findSortMock).toHaveBeenCalledWith({ issuedAt: -1, _id: -1 });
    expect(skipMock).toHaveBeenCalledWith(10);
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(findMock).toHaveBeenCalledWith({ storeId: expect.anything() });
    expect(page).toMatchObject({ total: 1, page: 2, totalPages: 1 });
  });

  it('says what became of each note: preview, captured, cancelled', async () => {
    findLeanMock.mockResolvedValue([
      doc({ accessKey: KEY_A, level: 'summary', hasXml: false }),
      doc({ accessKey: KEY_B, level: 'full' }),
      doc({ accessKey: '3'.repeat(44), level: 'full' }),
      doc({ accessKey: '4'.repeat(44), level: 'full' }),
    ]);
    invoiceLeanMock.mockResolvedValue([
      { accessKey: KEY_B, status: 'processed', itemsValue: 100, adjustmentsValue: 5 },
      { accessKey: '3'.repeat(44), status: 'cancelled' },
    ]);
    const { getNfeNotesPageForStore } = await import('@/app/lib/services/nfe-documents');

    const { data } = await getNfeNotesPageForStore(STORE_ID);

    expect(data.map((row) => row.status)).toEqual([
      'preview',
      'captured',
      'cancelled',
      'unprocessed',
    ]);
    expect(data[1]).toMatchObject({ itemsValue: 100, adjustmentsValue: 5, hasXml: true });
    expect(data[0]).toMatchObject({ level: 'summary', hasXml: false });
  });

  it('narrows to previews by level', async () => {
    const { getNfeNotesPageForStore } = await import('@/app/lib/services/nfe-documents');

    await getNfeNotesPageForStore(STORE_ID, { filter: 'preview' });

    expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'summary' }));
  });

  it('narrows to cancelled by the keys SEFAZ cancelled', async () => {
    invoiceLeanMock.mockResolvedValueOnce([{ accessKey: KEY_B }]);
    const { getNfeNotesPageForStore } = await import('@/app/lib/services/nfe-documents');

    await getNfeNotesPageForStore(STORE_ID, { filter: 'cancelled' });

    expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ accessKey: { $in: [KEY_B] } }));
  });

  it('searches by supplier, invoice number or part of the key', async () => {
    const { getNfeNotesPageForStore } = await import('@/app/lib/services/nfe-documents');

    await getNfeNotesPageForStore(STORE_ID, { q: '811931002252' });

    const query = findMock.mock.calls[0][0] as { $or: unknown[] };
    expect(query.$or).toHaveLength(3);
  });
});

describe('getNfeXmlForStore', () => {
  it('returns the stored XML, scoped to the store and only when one is kept', async () => {
    findOneLeanMock.mockResolvedValue({ xml: '<nfeProc/>' });
    const { getNfeXmlForStore } = await import('@/app/lib/services/nfe-documents');

    await expect(getNfeXmlForStore(STORE_ID, KEY_A)).resolves.toBe('<nfeProc/>');

    expect(findOneMock).toHaveBeenCalledWith({
      storeId: expect.anything(),
      accessKey: KEY_A,
      hasXml: true,
    });
    expect(findOneSelectMock).toHaveBeenCalledWith('+xml');
  });

  it('returns null for a preview, a PDF or another store’s key', async () => {
    findOneLeanMock.mockResolvedValue(null);
    const { getNfeXmlForStore } = await import('@/app/lib/services/nfe-documents');

    await expect(getNfeXmlForStore(STORE_ID, KEY_B)).resolves.toBeNull();
  });
});
