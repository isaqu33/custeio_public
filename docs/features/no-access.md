# No access

## Scope

Where an authenticated account with no organization lands, and why that page exists at all.

## Route

- UI route: `/no-access`, resolved by [`getLandingPath`](../../app/lib/landing.ts)

## Why

Every page under `/organization` scopes its query by `getAuthorizedOrganizationIds`. An account
that belongs to nothing therefore sees a series of **empty** screens — which reads as a broken app
rather than as setup that has not finished. This page says which of the two it is.

It shows the viewer's own email so they can quote it to whoever grants access. That is their own
address, so nothing here widens what they can see.

## Behavior

- Someone who _does_ have access never sits here: a stale link, or a membership granted since
  login, redirects out. System and Support bypass organization membership entirely and are sent on
  as well.
- The landing resolver picks the first page the session can actually open, rather than a fixed
  destination, so a session without access to a page is never logged straight into a denial screen
  — which reads as a broken login rather than a permission never granted. Today
  `LANDING_ORDER` holds only the dashboard, which needs no feature, so the resolver's job reduces to
  System/Support (everything reachable) versus everyone else.

## Restrictions

- Deliberately **unguarded** by a feature: guarding the page that explains a missing grant with a
  grant would be circular. `__tests__/server/page-guards.spec.ts` records it as intentionally open.

## Testing

- `__tests__/server/page-guards.spec.ts` (expected guard: `null`)
- The resolver itself ([`getLandingPath`](../../app/lib/landing.ts)) has no dedicated spec at the
  moment.
