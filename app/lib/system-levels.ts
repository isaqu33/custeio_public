/**
 * The system-level markers a user account can carry.
 *
 * A system level is not a permission — it is a *bypass*. `system` and `support`
 * skip feature checks entirely, which is what those two groups mean. Everyone
 * else is described by the union of their groups' features.
 */
export const SYSTEM_LEVELS = ['system', 'support'] as const;

export type SystemLevel = (typeof SYSTEM_LEVELS)[number];

export function hasHumanSystemAccess(systemLevel: readonly SystemLevel[] | undefined) {
  return Boolean(systemLevel?.some((level) => SYSTEM_LEVELS.includes(level)));
}
