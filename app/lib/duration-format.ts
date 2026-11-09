// Human-readable durations for the support views.
//
// The unit tokens (ms, s, min, h) are deliberately NOT translated: they are
// written the same way in every locale this app ships, and routing them through
// the dictionary would only add two more strings for translators to keep in sync
// with a formatting rule they cannot see.

const SECOND = 1_000;

/**
 * A duration at the precision the reader can act on: sub-second work is measured
 * in milliseconds (a per-image conversion rate), a stage in seconds or minutes,
 * a long study in hours and minutes. Never more than two units — "1 h 37 min" is
 * read at a glance, "1 h 37 min 12 s" is not.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < SECOND) return `${Math.round(ms)} ms`;

  // Round to whole seconds ONCE, up front, and derive every unit from that.
  // Rounding inside a branch instead is what produced "3 min 60 s" on a real
  // analysis job: the remainder rounded up to a full minute and was printed as a
  // remainder anyway. The same fault turns 59,6 s into "60 s" and 59 min 59,6 s
  // into "60 min". Carrying once, before choosing the unit, cannot do any of it.
  const totalSeconds = Math.round(ms / SECOND);

  // One decimal below ten seconds: the difference between 2 s and 2,4 s per image
  // is 400 extra seconds over a 1.000-image study.
  if (totalSeconds < 10) return `${(ms / SECOND).toFixed(1)} s`;
  if (totalSeconds < 60) return `${totalSeconds} s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    if (totalMinutes < 10 && seconds > 0) return `${totalMinutes} min ${seconds} s`;
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}
