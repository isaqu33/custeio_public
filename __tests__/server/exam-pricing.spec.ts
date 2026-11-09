/**
 * @jest-environment node
 */
import {
  bandBounds,
  bandForImages,
  isPriced,
  normalizeBands,
  summarizeExamBilling,
  type ExamBand,
} from '@/app/lib/billing/exam-pricing';

// The bands the boss specified, with prices filled in so the arithmetic is
// checkable. Deliberately NOT the shipped defaults (which are all zero).
const BANDS: ExamBand[] = [
  { maxImages: 10, priceBrl: 5 },
  { maxImages: 100, priceBrl: 12 },
  { maxImages: 1000, priceBrl: 40 },
  { maxImages: 5000, priceBrl: 150 },
];

describe('bandForImages', () => {
  it('puts an exam in the first band whose bound it does not exceed', () => {
    expect(bandForImages(BANDS, 1)?.priceBrl).toBe(5);
    expect(bandForImages(BANDS, 50)?.priceBrl).toBe(12);
    expect(bandForImages(BANDS, 390)?.priceBrl).toBe(40);
    expect(bandForImages(BANDS, 4600)?.priceBrl).toBe(150);
  });

  // Off-by-one here is the difference between two prices on a real invoice.
  it('treats the bound as inclusive', () => {
    expect(bandForImages(BANDS, 10)?.priceBrl).toBe(5);
    expect(bandForImages(BANDS, 11)?.priceBrl).toBe(12);
    expect(bandForImages(BANDS, 100)?.priceBrl).toBe(12);
    expect(bandForImages(BANDS, 101)?.priceBrl).toBe(40);
  });

  // An exam nobody priced must come back as "no band", never as the last band or
  // as free — the caller has to be able to say it could not be billed.
  it('returns null above the largest band when none is open-ended', () => {
    expect(bandForImages(BANDS, 5001)).toBeNull();
  });

  it('lets an open-ended last band catch any size', () => {
    const open = [...BANDS, { maxImages: null, priceBrl: 400 }];
    expect(bandForImages(open, 50_000)?.priceBrl).toBe(400);
  });

  it('orders bands itself rather than trusting the caller', () => {
    const shuffled = [BANDS[2], BANDS[0], BANDS[3], BANDS[1]] as ExamBand[];
    expect(bandForImages(shuffled, 50)?.priceBrl).toBe(12);
  });
});

describe('normalizeBands', () => {
  it('sorts ascending and keeps the open-ended band last', () => {
    const bands = normalizeBands([
      { maxImages: null, priceBrl: 400 },
      { maxImages: 100, priceBrl: 12 },
      { maxImages: 10, priceBrl: 5 },
    ]);
    expect(bands.map((band) => band.maxImages)).toEqual([10, 100, null]);
  });

  it('drops rows that cannot describe a band', () => {
    const bands = normalizeBands([
      { maxImages: 10, priceBrl: 5 },
      { maxImages: 0, priceBrl: 5 },
      { maxImages: 50, priceBrl: -1 },
      { maxImages: Number.NaN, priceBrl: 5 },
    ]);
    expect(bands).toEqual([{ maxImages: 10, priceBrl: 5 }]);
  });
});

describe('isPriced', () => {
  // Zero is "nobody decided yet", not "free". Everything downstream depends on
  // this distinction: an unpriced band's exams are excluded from the total.
  it('treats a zero price as undecided', () => {
    expect(isPriced({ maxImages: 10, priceBrl: 0 })).toBe(false);
    expect(isPriced({ maxImages: 10, priceBrl: 0.01 })).toBe(true);
    expect(isPriced(null)).toBe(false);
  });
});

describe('summarizeExamBilling', () => {
  it('totals exams per band', () => {
    const summary = summarizeExamBilling(
      [{ images: 5 }, { images: 8 }, { images: 390 }, { images: 2000 }],
      BANDS,
    );

    expect(summary.exams).toBe(4);
    expect(summary.images).toBe(2403);
    // 2 × 5 + 1 × 40 + 1 × 150
    expect(summary.totalBrl).toBe(200);
    expect(summary.unpricedExams).toBe(0);

    const smallest = summary.rows.find((row) => row.band.maxImages === 10);
    expect(smallest?.exams).toBe(2);
    expect(smallest?.subtotalBrl).toBe(10);
  });

  // The whole point of the unpriced count: a period must never quietly bill less
  // than the exams it ran without saying that is what happened.
  it('counts exams it cannot price and leaves them out of the total', () => {
    const summary = summarizeExamBilling(
      [{ images: 5 }, { images: 9000 }, { images: 12_000 }],
      BANDS,
    );

    expect(summary.exams).toBe(3);
    expect(summary.totalBrl).toBe(5);
    expect(summary.unpricedExams).toBe(2);
  });

  it('counts an exam in an unpriced band as unpriced, not as free', () => {
    const summary = summarizeExamBilling([{ images: 5 }], [{ maxImages: 10, priceBrl: 0 }]);

    expect(summary.exams).toBe(1);
    expect(summary.totalBrl).toBe(0);
    expect(summary.unpricedExams).toBe(1);
    expect(summary.rows[0]?.exams).toBe(1);
  });

  it('reports an empty period as zero rather than failing', () => {
    const summary = summarizeExamBilling([], BANDS);
    expect(summary).toMatchObject({ exams: 0, images: 0, totalBrl: 0, unpricedExams: 0 });
    expect(summary.rows).toHaveLength(BANDS.length);
  });
});

describe('bandBounds', () => {
  it('reads each band from the one below it', () => {
    const ordered = normalizeBands(BANDS);
    expect(bandBounds(ordered, ordered[0] as ExamBand)).toEqual({ from: 1, to: 10 });
    expect(bandBounds(ordered, ordered[1] as ExamBand)).toEqual({ from: 11, to: 100 });
    expect(bandBounds(ordered, ordered[3] as ExamBand)).toEqual({ from: 1001, to: 5000 });
  });

  it('reports the open-ended band with no upper bound', () => {
    const ordered = normalizeBands([...BANDS, { maxImages: null, priceBrl: 400 }]);
    expect(bandBounds(ordered, ordered[4] as ExamBand)).toEqual({ from: 5001, to: null });
  });
});
