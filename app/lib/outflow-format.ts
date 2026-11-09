// How the Consumo interno / Avarias pages show a moment: the PDV's local time, not the server's.
const LOCALE = 'pt-BR';
const TIME_ZONE = 'America/Sao_Paulo';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  });

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
