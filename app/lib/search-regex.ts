/**
 * Escapes a user-supplied term before it goes into a Mongo `$regex`.
 *
 * Without this a search box is a regex injection point: `(((((` is a syntax
 * error the driver rejects, and a nested quantifier such as `(a+)+b` makes the
 * engine backtrack catastrophically on long values — one request can pin a CPU.
 * Every service that builds a `$regex` from a search term must go through here.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A case-insensitive "contains" condition for an already-trimmed term. */
export function containsCondition(term: string) {
  return { $regex: escapeRegex(term), $options: 'i' as const };
}
