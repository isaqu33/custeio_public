/**
 * @jest-environment node
 */
export {};

import { parseNfeXml } from '@/app/lib/nfe-xml';

const ACCESS_KEY = '35260912345678000199550010000000011234567890';

function nfeProcXml(overrides: { det?: string; chNFe?: string } = {}) {
  const det =
    overrides.det ??
    `
    <det nItem="1">
      <prod>
        <cProd>SKU-001</cProd>
        <xProd>QUEIJO MUSSARELA FRIBOI 1KG</xProd>
        <uCom>CX</uCom>
        <qCom>1.0000</qCom>
        <uTrib>KG</uTrib>
        <qTrib>12.0000</qTrib>
        <vProd>120.00</vProd>
      </prod>
    </det>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc>
    <NFe>
      <infNFe Id="NFe${ACCESS_KEY}">
        <ide><dhEmi>2026-09-20T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>12.345.678/0001-99</CNPJ></emit>
        ${det}
        <total><ICMSTot><vNF>120.00</vNF></ICMSTot></total>
      </infNFe>
    </NFe>
    <protNFe><infProt><chNFe>${overrides.chNFe ?? ACCESS_KEY}</chNFe></infProt></protNFe>
  </nfeProc>`;
}

describe('parseNfeXml', () => {
  it('parses the access key, supplier, issue date and items', () => {
    const parsed = parseNfeXml(nfeProcXml());

    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(parsed.supplierCnpj).toBe('12345678000199');
    expect(parsed.issuedAt.toISOString()).toContain('2026-09-20');
    expect(parsed.totalValue).toBe(120);
    expect(parsed.items).toEqual([
      {
        supplierItemCode: 'SKU-001',
        description: 'QUEIJO MUSSARELA FRIBOI 1KG',
        gtin: undefined,
        commercialUnit: 'CX',
        commercialQuantity: 1,
        taxUnit: 'KG',
        taxQuantity: 12,
        totalValue: 120,
        landedValue: 120,
      },
    ]);
  });

  it('reads a single det line without an array wrapper the same as multiple', () => {
    const det = `
      <det nItem="1"><prod><cProd>A</cProd><xProd>Item A</xProd><uCom>UN</uCom><qCom>1</qCom><uTrib>UN</uTrib><qTrib>1</qTrib><vProd>1</vProd></prod></det>
      <det nItem="2"><prod><cProd>B</cProd><xProd>Item B</xProd><uCom>UN</uCom><qCom>2</qCom><uTrib>UN</uTrib><qTrib>2</qTrib><vProd>2</vProd></prod></det>`;

    const parsed = parseNfeXml(nfeProcXml({ det }));

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map((item) => item.supplierItemCode)).toEqual(['A', 'B']);
  });

  it('rejects a resNFe summary (no infNFe items)', () => {
    expect(() => parseNfeXml('<resNFe><chNFe>' + ACCESS_KEY + '</chNFe></resNFe>')).toThrow(
      /resNFe summary/,
    );
  });

  it('rejects malformed XML', () => {
    expect(() => parseNfeXml('not xml at all <<<')).toThrow();
  });

  it('rejects an access key that is not 44 digits', () => {
    expect(() => parseNfeXml(nfeProcXml({ chNFe: '123' }))).toThrow(/access key/);
  });

  describe('supplier and invoice identity', () => {
    it('reads the supplier name, trade name, invoice number and series', () => {
      const xml = nfeProcXml()
        .replace(
          '<emit><CNPJ>12.345.678/0001-99</CNPJ></emit>',
          '<emit><CNPJ>12345678000199</CNPJ><xNome>COSTA MULTICANAL S/A</xNome><xFant>LOJA SANTA MARIA</xFant></emit>',
        )
        .replace('<ide><dhEmi>', '<ide><nNF>1139172</nNF><serie>3</serie><dhEmi>');

      const parsed = parseNfeXml(xml);

      expect(parsed).toMatchObject({
        supplierName: 'COSTA MULTICANAL S/A',
        supplierTradeName: 'LOJA SANTA MARIA',
        number: '1139172',
        series: '3',
      });
    });

    it('falls back to the CNPJ as a name, and leaves the optional identity out', () => {
      const parsed = parseNfeXml(nfeProcXml());

      expect(parsed.supplierName).toBe('12345678000199');
      expect(parsed.supplierTradeName).toBeUndefined();
      expect(parsed.number).toBeUndefined();
    });
  });

  describe('landed cost (what a line really cost)', () => {
    const line = (code: string, value: number, extra = '') =>
      `<det nItem="1"><prod><cProd>${code}</cProd><xProd>Item ${code}</xProd><uCom>UN</uCom><qCom>1</qCom><uTrib>UN</uTrib><qTrib>1</qTrib><vProd>${value.toFixed(2)}</vProd>${extra}</prod></det>`;
    const invoice = (det: string, vNF: number) =>
      nfeProcXml({ det }).replace('<vNF>120.00</vNF>', `<vNF>${vNF.toFixed(2)}</vNF>`);
    const landed = (xml: string) => parseNfeXml(xml).items.map((item) => item.landedValue);

    it('is the item value when the invoice total adds nothing', () => {
      const parsed = parseNfeXml(invoice(line('A', 100) + line('B', 50), 150));

      expect(landed(invoice(line('A', 100) + line('B', 50), 150))).toEqual([100, 50]);
      expect(parsed.adjustmentsValue).toBe(0);
      expect(parsed.itemsValue).toBe(150);
    });

    it('spreads a note-level freight across the lines in proportion to their value', () => {
      // 12,00 of freight over 100 + 50: the first line carries 8, the second 4.
      const xml = invoice(line('A', 100) + line('B', 50), 162);

      expect(landed(xml)).toEqual([108, 54]);
      expect(parseNfeXml(xml).adjustmentsValue).toBe(12);
    });

    it('spreads a note-level discount the same way, lowering the cost', () => {
      const xml = invoice(line('A', 100) + line('B', 50), 142.5);

      const [a, b] = landed(xml);
      expect(a).toBeCloseTo(95);
      expect(b).toBeCloseTo(47.5);
    });

    it('charges a line its own discount and freight before spreading the rest', () => {
      // A: 100 - 10 discount = 90; B: 50 + 5 freight = 55; the total says 145 -> nothing left to spread.
      const xml = invoice(
        line('A', 100, '<vDesc>10.00</vDesc>') + line('B', 50, '<vFrete>5.00</vFrete>'),
        145,
      );

      expect(landed(xml)).toEqual([90, 55]);
    });

    it('does not spread a gap it cannot explain (a total far from the items)', () => {
      const xml = invoice(line('A', 100) + line('B', 50), 900);

      expect(landed(xml)).toEqual([100, 50]);
      // The gap is still reported honestly on the invoice; it just is not put in any line's cost.
      expect(parseNfeXml(xml).adjustmentsValue).toBe(750);
    });

    it('does not spread anything when the total is missing', () => {
      const xml = invoice(line('A', 100), 0);

      expect(landed(xml)).toEqual([100]);
    });

    it('keeps the landed values summing to the invoice total', () => {
      const xml = invoice(line('A', 100) + line('B', 33.33) + line('C', 7.77), 155.55);

      const sum = landed(xml).reduce((total, value) => total + value, 0);
      expect(sum).toBeCloseTo(155.55, 6);
    });
  });
});

describe('parseNfeSummaryXml', () => {
  const KEY = '53261081611931002252550030012040341199141519';
  const summary = (extra = '') =>
    `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${KEY}</chNFe><CNPJ>81611931002252</CNPJ><xNome>OESA COMERCIO</xNome><dhEmi>2026-10-06T03:38:00-03:00</dhEmi><vNF>1100.73</vNF>${extra}</resNFe>`;

  it('reads the preview: key, supplier, date and value, never items', () => {
    const { parseNfeSummaryXml } = jest.requireActual('@/app/lib/nfe-xml');

    expect(parseNfeSummaryXml(summary())).toEqual({
      accessKey: KEY,
      issuedAt: new Date('2026-10-06T06:38:00.000Z'),
      totalValue: 1100.73,
      supplierCnpj: '81611931002252',
      supplierName: 'OESA COMERCIO',
    });
  });

  it('rejects a document that is not a resNFe', () => {
    const { parseNfeSummaryXml } = jest.requireActual('@/app/lib/nfe-xml');

    expect(() => parseNfeSummaryXml('<nfeProc/>')).toThrow('not a resNFe summary');
  });

  it('rejects a summary without a readable access key', () => {
    const { parseNfeSummaryXml } = jest.requireActual('@/app/lib/nfe-xml');

    expect(() => parseNfeSummaryXml(summary().replace(KEY, '123'))).toThrow('access key');
  });
});
