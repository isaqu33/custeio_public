/**
 * @jest-environment node
 */
export {};

import { parseNfeText } from '@/app/lib/nfe-pdf';

// A synthetic access key with a real, mod-11-valid check digit (computed the
// same way `accessKeyChecksOut` in nfe-pdf.ts does) — not a real invoice's
// key, but shaped exactly like one so `findAccessKey` accepts it the same
// way it would a real DANFE's. See docs/features/sefaz-nfe.md for why a real
// invoice's extracted text is never committed as a fixture.
const ACCESS_KEY = '35260911222333000181550010000001231000000013';
const ACCESS_KEY_GROUPED = '3526 0911 2223 3300 0181 5500 1000 0001 2310 0000 0013';

const ITEM_TABLE_HEADER =
  'CÓDIGO PRODUTO DESCRIÇÃO DO PRODUTO/SERVIÇO CFOP UN QUANT VALOR UNIT VALOR TOTAL O/CSOSN';

/** Builds text shaped like what `unpdf`'s `extractText` returns for a DANFE:
 * the printed access key, the mandatory receipt sentence, and (optionally) an
 * item table between "DADOS DO PRODUTO" and "DADOS ADICIONAIS". */
function danfeText(
  opts: {
    accessKey?: string;
    supplier?: string;
    date?: string;
    total?: string;
    items?: string; // pre-built rows, already following ITEM_TABLE_HEADER
  } = {},
) {
  const {
    accessKey = ACCESS_KEY_GROUPED,
    supplier = 'FORNECEDOR TESTE LTDA',
    date = '20/09/2026',
    total = '150,00',
    items,
  } = opts;

  return `
DANFE Documento Auxiliar da Nota Fiscal Eletrônica
0 - ENTRADA
1 - SAÍDA
Nº 000000123 SÉRIE 1
${accessKey}
CHAVE DE ACESSO
RECEBEMOS DE ${supplier} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO
EMISSÃO: ${date}
VALOR TOTAL: R$${total}
DESTINATÁRIO: LOJA TESTE
${items !== undefined ? `DADOS DO PRODUTO\n${ITEM_TABLE_HEADER}\n${items}\nDADOS ADICIONAIS` : ''}
`;
}

describe('parseNfeText', () => {
  it('parses the access key, supplier, issue date and total from the receipt line', () => {
    const parsed = parseNfeText(danfeText());

    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(parsed.supplierCnpj).toBe('11222333000181');
    expect(parsed.supplierName).toBe('FORNECEDOR TESTE LTDA');
    expect(parsed.number).toBe('123');
    expect(parsed.series).toBe('1');
    expect(parsed.totalValue).toBe(150);
    expect(parsed.issuedAt.toISOString()).toContain('2026-09-20');
  });

  it('captures the invoice even with no item table (header fields still reliable)', () => {
    const parsed = parseNfeText(danfeText());

    expect(parsed.items).toEqual([]);
    expect(parsed.itemsValue).toBe(0);
  });

  it('rejects text with no readable access key', () => {
    expect(() => parseNfeText(danfeText().replace(ACCESS_KEY_GROUPED, ''))).toThrow(/access key/);
  });

  it('rejects text with no receipt line (supplier/date/total)', () => {
    expect(() => parseNfeText(danfeText().replace(/RECEBEMOS DE[\s\S]*?LADO/, ''))).toThrow(
      /receipt line/,
    );
  });

  describe('item table (best-effort, self-validated)', () => {
    it('reads a single item and computes its landed value', () => {
      const items = '001 ITEM TESTE UM 0/102 5102 UN 10,0000 10,0000 100,00';
      const parsed = parseNfeText(danfeText({ items, total: '100,00' }));

      expect(parsed.items).toEqual([
        {
          supplierItemCode: 'item-teste-um',
          description: 'ITEM TESTE UM',
          commercialUnit: 'UN',
          commercialQuantity: 10,
          taxUnit: 'UN',
          taxQuantity: 10,
          totalValue: 100,
          landedValue: 100,
        },
      ]);
    });

    it('reads several items and spreads freight/discount into their landed value', () => {
      const items = [
        '001 ITEM TESTE UM 0/102 5102 UN 10,0000 10,0000 100,00',
        '002 ITEM TESTE DOIS 0/102 5102 KG 5,0000 10,0000 50,00',
      ].join('\n');
      // 150 in items, 162 on the invoice -> 12,00 of freight spread proportionally.
      const parsed = parseNfeText(danfeText({ items, total: '162,00' }));

      expect(parsed.items.map((item) => item.description)).toEqual([
        'ITEM TESTE UM',
        'ITEM TESTE DOIS',
      ]);
      expect(parsed.items.map((item) => item.landedValue)).toEqual([108, 54]);
      expect(parsed.adjustmentsValue).toBe(12);
    });

    it('strips diacritics from the description when deriving supplierItemCode', () => {
      const items = '001 PÃO BRIOCHE NO ARO 0/102 5102 UNID 1.074,0000 1,3500 1.449,90';
      const parsed = parseNfeText(danfeText({ items, total: '1.449,90' }));

      expect(parsed.items[0]).toMatchObject({
        supplierItemCode: 'pao-brioche-no-aro',
        description: 'PÃO BRIOCHE NO ARO',
      });
    });

    it('drops a line whose quantity × unit price does not match its total', () => {
      // A spurious CFOP-shaped anchor elsewhere in the section that does not
      // self-validate is dropped rather than drafted with a guessed quantity.
      const items = '001 ITEM QUEBRADO 0/102 5102 UN 10,0000 10,0000 999,00';
      const parsed = parseNfeText(danfeText({ items, total: '999,00' }));

      expect(parsed.items).toEqual([]);
    });

    it('leaves items empty when the product-section markers are absent', () => {
      const parsed = parseNfeText(danfeText());

      expect(parsed.items).toEqual([]);
    });
  });
});
