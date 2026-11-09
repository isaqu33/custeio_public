// What an ingredient is called besides its name, and how it is recognized in a note or on a shelf:
// nicknames the team uses ("carne", "blend"), barcodes (EAN/GTIN) and the pack it is bought in.
// Pure and worker-safe. The nicknames and barcodes are what lets a free-text message ("quanto de
// carne tem?") or a receipt line find the right ingredient later (docs/features/whatsapp-quick-query.md).

export const MAX_ALIASES = 10;
export const MAX_ALIAS_LENGTH = 40;
export const MAX_BARCODES = 5;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Lower case, no accents: the form in which two spellings of a name are the same name. */
export function foldText(text: string): string {
  return collapse(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Cleans a list of nicknames: collapsed spaces, no empties, no repeats (accent and case
 * insensitive), none equal to the ingredient's own name, at most {@link MAX_ALIASES}.
 */
export function normalizeAliases(aliases: readonly string[], ingredientName: string): string[] {
  const seen = new Set([foldText(ingredientName)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = collapse(raw).slice(0, MAX_ALIAS_LENGTH);
    const key = foldText(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length === MAX_ALIASES) break;
  }
  return out;
}

/** Barcodes are 8 to 14 digits (EAN-8, UPC, EAN-13, GTIN-14): digits only, no repeats, at most {@link MAX_BARCODES}. */
export function normalizeBarcodes(barcodes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of barcodes) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 14) out.add(digits);
    if (out.size === MAX_BARCODES) break;
  }
  return [...out];
}

export type PurchasePack = { label?: string; quantity: number };

/**
 * The pack the ingredient is bought in, in the ingredient's own unit ("Fardo 12 un" = 12 un,
 * "Bag 1,6 kg" = 1600 g). `null` when there is none worth keeping.
 */
export function normalizePurchasePack(
  pack: { label?: string; quantity: number } | null | undefined,
): PurchasePack | null {
  if (!pack || !Number.isFinite(pack.quantity) || pack.quantity <= 0) return null;
  const label = pack.label ? collapse(pack.label).slice(0, 40) : '';
  return { ...(label && { label }), quantity: Number(pack.quantity.toFixed(3)) };
}
