/**
 * @jest-environment node
 */
export {};

// CSV for an owner opening the file in Excel pt-BR: `;` separated, `,` decimal,
// UTF-8 BOM — and safe against text an outside system controls.
describe('csvCell', () => {
  it('formats numbers with a decimal comma and at most 4 decimals', async () => {
    const { csvCell } = await import('@/app/lib/csv');

    expect(csvCell(12490.05)).toBe('12490,05');
    expect(csvCell(0.0076)).toBe('0,0076');
    expect(csvCell(0.123456)).toBe('0,1235');
    expect(csvCell(-5.2)).toBe('-5,2'); // a negative NUMBER is not a formula
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('writes booleans in Portuguese and empty for nothing', async () => {
    const { csvCell } = await import('@/app/lib/csv');

    expect(csvCell(true)).toBe('sim');
    expect(csvCell(false)).toBe('não');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes text with the separator, quotes or line breaks, doubling the quotes', async () => {
    const { csvCell } = await import('@/app/lib/csv');

    expect(csvCell('Queijo; prato')).toBe('"Queijo; prato"');
    expect(csvCell('Pão "artesanal"')).toBe('"Pão ""artesanal"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
    expect(csvCell('Simples')).toBe('Simples');
  });

  it('keeps commas unquoted: the separator is the semicolon', async () => {
    const { csvCell } = await import('@/app/lib/csv');

    expect(csvCell('Arroz, feijão')).toBe('Arroz, feijão');
  });

  it.each(['=HYPERLINK("http://x")', '+1+1', '-cmd', '@SUM(A1)', '\tx', '\rx'])(
    'defuses spreadsheet formulas in text (%p)',
    async (value) => {
      const { csvCell } = await import('@/app/lib/csv');

      expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
    },
  );
});

describe('toCsv', () => {
  it('starts with a BOM, joins with ; and CRLF, and ends with a line break', async () => {
    const { toCsv } = await import('@/app/lib/csv');

    const csv = toCsv(
      ['Insumo', 'Custo'],
      [
        ['Queijo', 1.5],
        ['Pão', undefined],
      ],
    );

    expect(csv).toBe('﻿Insumo;Custo\r\nQueijo;1,5\r\nPão;\r\n');
  });

  it('is just the header for no rows', async () => {
    const { toCsv } = await import('@/app/lib/csv');

    expect(toCsv(['A', 'B'], [])).toBe('﻿A;B\r\n');
  });
});

describe('csvFileName / csvResponse', () => {
  it('dates the file in São Paulo time, not UTC', async () => {
    const { csvFileName } = await import('@/app/lib/csv');

    // 01:30 UTC on the 27th is still the evening of the 26th in Brazil.
    expect(csvFileName('produtos', new Date('2026-09-27T01:30:00Z'))).toBe(
      'produtos-2026-09-26.csv',
    );
  });

  it('answers as a non-cached attachment', async () => {
    const { csvResponse } = await import('@/app/lib/csv');

    const res = csvResponse('x', 'insumos-2026-09-26.csv');

    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="insumos-2026-09-26.csv"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
