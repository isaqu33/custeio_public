import ipaddr from 'ipaddr.js';

function normalizeIp(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  // x-forwarded-for may include IPv4:port
  const firstPart = raw.split(':').at(0);
  const withoutPort = raw.includes(':') && raw.split(':').length === 2 ? (firstPart ?? raw) : raw;
  if (!ipaddr.isValid(withoutPort)) return null;
  return ipaddr.parse(withoutPort).toString();
}

export function getClientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',').at(0);
    if (!first) return 'unknown';
    const parsed = normalizeIp(first);
    if (parsed) return parsed;
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    const parsed = normalizeIp(realIp);
    if (parsed) return parsed;
  }

  return 'unknown';
}
