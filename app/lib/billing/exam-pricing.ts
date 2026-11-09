// PLATFORM BILLING — what the CLIENT pays: one price per exam, chosen by how
// many images the exam had.
//
// This is deliberately a different ruler from `app/lib/ai/pricing.ts`. That one
// answers "what did the provider charge us for these tokens" and is our cost;
// this one answers "what do we invoice for this exam" and is the product. They
// are not proportional and must not be derived from each other: the AI cost of a
// study is measured in cents, while the exam price is set against the market
// value of a report. Keeping them apart is what lets the price survive a provider
// changing its rates.
//
// Pure module — no DB, no env, no server imports — so the band maths can be unit
// tested and reused on the client. The stored bands live in SystemSettings and
// are loaded by `app/lib/services/exam-pricing-settings.ts`.

// One price band. `maxImages` is the INCLUSIVE upper bound; the band covers
// everything above the previous band's bound up to this one. A null bound means
// "and anything larger", which only the last band may carry.
export type ExamBand = {
  maxImages: number | null;
  priceBrl: number;
};

// The bands the boss specified (2026-08-26). Prices start at zero on purpose:
// they are a commercial decision nobody has made yet, and a made-up default would
// quietly become the number on an invoice. Zero is reported as "not priced",
// never as a free exam — see `isPriced`.
export const DEFAULT_EXAM_BANDS: readonly ExamBand[] = [
  { maxImages: 10, priceBrl: 0 },
  { maxImages: 100, priceBrl: 0 },
  { maxImages: 1000, priceBrl: 0 },
  { maxImages: 5000, priceBrl: 0 },
  { maxImages: 10000, priceBrl: 0 },
];

// A band priced at zero has not been decided yet. The distinction matters: an
// invoice line of R$ 0,00 looks like a deliberate freebie, and a period total
// that silently includes unpriced exams is wrong in a way nobody can see.
export function isPriced(band: ExamBand | null | undefined): boolean {
  return Boolean(band && band.priceBrl > 0);
}

// Sort ascending, with the open-ended band (if any) last, and drop rows that
// cannot describe a band. Callers should treat the result as the canonical order
// — the lookup below assumes it.
export function normalizeBands(bands: readonly ExamBand[]): ExamBand[] {
  const valid = bands.filter(
    (band) =>
      typeof band?.priceBrl === 'number' &&
      Number.isFinite(band.priceBrl) &&
      band.priceBrl >= 0 &&
      (band.maxImages === null ||
        (typeof band.maxImages === 'number' &&
          Number.isFinite(band.maxImages) &&
          band.maxImages >= 1)),
  );
  return [...valid].sort((a, b) => {
    if (a.maxImages === null) return 1;
    if (b.maxImages === null) return -1;
    return a.maxImages - b.maxImages;
  });
}

// The band an exam of `images` falls into, or null when it is larger than every
// band and none is open-ended. Null is a real answer here — an exam nobody
// priced — and callers must show it as such rather than billing it at zero.
export function bandForImages(bands: readonly ExamBand[], images: number): ExamBand | null {
  if (!Number.isFinite(images) || images < 0) return null;
  for (const band of normalizeBands(bands)) {
    if (band.maxImages === null || images <= band.maxImages) return band;
  }
  return null;
}

export type ExamBandTotal = {
  band: ExamBand;
  exams: number;
  images: number;
  /** exams × price, in BRL. Zero when the band has no price yet. */
  subtotalBrl: number;
};

export type ExamBillingSummary = {
  exams: number;
  images: number;
  /** Sum of the priced bands only. */
  totalBrl: number;
  rows: ExamBandTotal[];
  /**
   * Exams the bands could not price — either larger than every band, or landing
   * in one whose price is still zero. They are counted here and left OUT of
   * `totalBrl`, so the amount is always "what we can actually invoice" and the
   * gap is visible instead of being absorbed silently.
   */
  unpricedExams: number;
};

// Roll a period's exams up into per-band totals. `exams` is one entry per exam
// with its image count — the caller gets that from the jobs collection, which is
// the only record of how big each study was.
export function summarizeExamBilling(
  exams: readonly { images: number }[],
  bands: readonly ExamBand[],
): ExamBillingSummary {
  const ordered = normalizeBands(bands);
  const totals = new Map<ExamBand, ExamBandTotal>(
    ordered.map((band) => [band, { band, exams: 0, images: 0, subtotalBrl: 0 }]),
  );
  let unpricedExams = 0;

  for (const exam of exams) {
    const band = bandForImages(ordered, exam.images);
    if (!band) {
      unpricedExams += 1;
      continue;
    }
    const row = totals.get(band);
    if (!row) continue;
    row.exams += 1;
    row.images += exam.images;
    if (isPriced(band)) row.subtotalBrl += band.priceBrl;
    else unpricedExams += 1;
  }

  const rows = [...totals.values()];
  return {
    exams: exams.length,
    images: exams.reduce((sum, exam) => sum + exam.images, 0),
    totalBrl: rows.reduce((sum, row) => sum + row.subtotalBrl, 0),
    rows,
    unpricedExams,
  };
}

// A human label for a band, built from the band BELOW it so the boundaries read
// the way the price list was written ("100 a 1.000 imagens"). Formatting is the
// caller's (locale), so this returns the two numbers rather than a string.
export function bandBounds(
  bands: readonly ExamBand[],
  band: ExamBand,
): { from: number; to: number | null } {
  const ordered = normalizeBands(bands);
  const index = ordered.indexOf(band);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const from = previous?.maxImages ? previous.maxImages + 1 : 1;
  return { from, to: band.maxImages };
}
