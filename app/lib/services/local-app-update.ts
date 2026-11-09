export type LocalAppUpdateConfig = {
  enabled?: boolean | null;
  version?: string | null;
  url?: string | null;
  sha256?: string | null;
  signature?: string | null;
  required?: boolean | null;
};

export type LocalAppUpdateInfo = {
  required: boolean;
  version: string;
  url: string;
  sha256: string;
  signature?: string;
};

const SHA256_RE = /^[a-f0-9]{64}$/i;

function parseVersion(value: string) {
  return value
    .split('.')
    .map((part) => Number.parseInt(part.replace(/\D.*$/, ''), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
export function compareVersions(a: string, b: string) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

function toUpdateInfo(config?: LocalAppUpdateConfig | null): LocalAppUpdateInfo | null {
  if (!config?.enabled) return null;
  if (!config.version || !config.url || !config.sha256) return null;
  if (!SHA256_RE.test(config.sha256)) return null;
  return {
    required: config.required !== false,
    version: config.version,
    url: config.url,
    sha256: config.sha256.toLowerCase(),
    ...(config.signature && { signature: config.signature }),
  };
}

export function resolveLocalAppUpdate(input: {
  currentVersion?: string | null;
  tokenUpdate?: LocalAppUpdateConfig | null;
  globalUpdate?: LocalAppUpdateConfig | null;
}) {
  const candidate = toUpdateInfo(input.tokenUpdate) ?? toUpdateInfo(input.globalUpdate);
  if (!candidate) return null;
  if (input.currentVersion && compareVersions(input.currentVersion, candidate.version) >= 0) {
    return null;
  }
  return candidate;
}
