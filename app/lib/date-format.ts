import { format } from 'date-fns';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateShort(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'dd-MMM-yyyy');
}

export function formatDateShortUtc(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()] ?? 'Jan';
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

export function formatTimeShort(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'HH:mm');
}

export function formatTimeShortUtc(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}
