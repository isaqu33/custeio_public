// Blob/file-name helpers shared by the RayPilot analysis pipeline and the
// System (brand asset) upload. Pure string utilities — no domain logic.

/**
 * Picks a safe Azure blob folder identifier from a Token's name. Falls back to
 * the Token._id (always safe characters) when name is empty or sanitizes to
 * nothing, so uploads land in a deterministic folder.
 */
export function pickBlobFolder(name: string | undefined | null, fallbackId: string): string {
  if (!name) return fallbackId;
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return safe || fallbackId;
}

export function sanitizeFileName(fileName: string, fallback = 'upload.dat'): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? '';
  const safe = baseName
    .trim()
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return safe || fallback;
}
