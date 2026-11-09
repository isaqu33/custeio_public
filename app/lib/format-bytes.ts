const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Byte count as a short human string ("512 MB", "1.5 GB").
 *
 * Binary steps (1024) with decimal unit names, which is what file managers show
 * and therefore what a user comparing their zip against the limit expects.
 * One decimal place, and never a trailing ".0".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = value >= 10 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[exponent]}`;
}
