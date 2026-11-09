export function hexToHslChannels(hex: string, fallback: string): string {
  const normalized = hex.trim().replace('#', '');
  const validHex = normalized.length === 3 || normalized.length === 6;
  if (!validHex || !/^[0-9a-fA-F]+$/.test(normalized)) return fallback;

  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => `${c}${c}`)
          .join('')
      : normalized;

  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
