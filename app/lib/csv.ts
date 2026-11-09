// CSV for the "Exportar" buttons. Built for the person who will open it: a
// Brazilian owner double-clicking the file in Excel. That means `;` as the
// separator and `,` as the decimal mark (Excel pt-BR reads a comma-separated
// file as one column and "12.5" as text), plus a UTF-8 BOM so accents survive.
// The machine-oriented users/organizations exports are a different thing.

export const CSV_SEPARATOR = ';';
const BOM = '﻿';
const LINE_BREAK = '\r\n';

export type CsvCell = string | number | boolean | null | undefined;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  // 4 decimals: a gram or millilitre costs fractions of a cent.
  return String(Number(value.toFixed(4))).replace('.', ',');
}

/**
 * One cell. Text can come from outside our control (an Alloy product name, a
 * supplier's description), so anything a spreadsheet would run as a formula
 * (`=`, `+`, `-`, `@`, tab, CR) is defused with a leading apostrophe.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';

  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(CSV_SEPARATOR));
  return BOM + lines.join(LINE_BREAK) + LINE_BREAK;
}

/** "produtos-2026-09-26.csv" — the day the file was made, in São Paulo time. */
export function csvFileName(prefix: string, now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `${prefix}-${day}.csv`;
}

/** The response every export route returns: the file as a download, never cached. */
export function csvResponse(csv: string, fileName: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
