/**
 * The feature each navigable `/organization` page sits behind, keyed by its
 * page's own required feature. Empty for now — Dashboard is open to any
 * authenticated, organization-scoped session, so it needs no entry. Add one
 * here (and to `LANDING_ORDER` below) the day a gated `/organization` page
 * exists again; `/system` entries are gated by System/Support access instead,
 * enforced in `app/(protected)/system/layout.tsx`.
 */
export const NAV_REQUIRED_FEATURE: Record<string, never> = {};

/**
 * Order the landing resolver walks. Most-useful first, not alphabetical: this
 * is "where should this person start", which is a product answer, unlike the
 * sidebar order which is "where do I find things".
 */
const LANDING_ORDER = ['/organization/dashboard'] as const;

/**
 * The first page this session can actually open, or `null` when there is none.
 *
 * Resolved rather than fixed. Sending everyone to `/organization/dashboard`
 * unconditionally meant a session without even that page logged straight into
 * a denial screen, which reads as a broken login rather than as a permission
 * they were never given.
 *
 * `features === null` is the System/Support bypass — everything is reachable.
 */
export function getLandingPath(features: Set<string> | null): string | null {
  if (features === null) return LANDING_ORDER[0];
  return (
    LANDING_ORDER.find((path) => {
      const required = NAV_REQUIRED_FEATURE[path];
      // No entry in the map means the page needs no feature — reachable by
      // any authenticated, organization-scoped session.
      return required ? features.has(required) : true;
    }) ?? null
  );
}
