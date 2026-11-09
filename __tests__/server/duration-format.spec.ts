/**
 * @jest-environment node
 */
import { formatDuration } from '@/app/lib/duration-format';

describe('formatDuration', () => {
  it('picks the unit the reader can act on', () => {
    expect(formatDuration(34)).toBe('34 ms');
    expect(formatDuration(2_400)).toBe('2.4 s');
    expect(formatDuration(38_000)).toBe('38 s');
    expect(formatDuration(264_000)).toBe('4 min 24 s');
    expect(formatDuration(5_820_000)).toBe('1 h 37 min');
  });

  // A real analysis job rendered its AI phase as "3 min 60 s": the seconds
  // remainder rounded up to a full minute and was printed as-is.
  it('carries a remainder that rounds up to a whole unit', () => {
    expect(formatDuration(239_700)).toBe('4 min');
    // The same fault at every boundary, not just the one that was seen.
    expect(formatDuration(59_600)).toBe('1 min');
    expect(formatDuration(3_599_600)).toBe('1 h');
    expect(formatDuration(3_540_000 + 59_600)).toBe('1 h');
  });

  it('reports an unusable value rather than a wrong one', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});
