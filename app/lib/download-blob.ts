// Trigger a browser download for a Blob. Creates a temporary object URL,
// dispatches a click on an anchor, then revokes the URL to free memory.
// Must run in the browser — callers should already be in a 'use client' file.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
