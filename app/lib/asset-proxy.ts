const ASSET_ROUTE_PREFIX = '/api/assets';

export function assetProxyUrl(blobPath: string | null | undefined): string {
  if (!blobPath) return '';
  if (blobPath.startsWith(ASSET_ROUTE_PREFIX)) return blobPath;
  if (/^https?:\/\//i.test(blobPath)) return '';

  const safePath = blobPath
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map(encodeURIComponent)
    .join('/');

  return safePath ? `${ASSET_ROUTE_PREFIX}/${safePath}` : '';
}

export function blobPathFromStoredValue(value: string | null | undefined, containerName: string) {
  if (!value) return '';
  if (value.startsWith(ASSET_ROUTE_PREFIX)) {
    return decodeURIComponent(value.slice(ASSET_ROUTE_PREFIX.length + 1));
  }
  if (!/^https?:\/\//i.test(value)) return value;

  const parts = new URL(value).pathname.split('/').filter(Boolean);
  const containerIndex = parts.indexOf(containerName);
  if (containerIndex === -1) return '';
  return parts.slice(containerIndex + 1).join('/');
}
