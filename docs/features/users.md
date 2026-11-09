# Users

## Scope

The platform's people: who exists, which organizations they belong to, whether they carry System
access, and the forced first-login password change.

## Routes

- UI route: `/system/users`
- API routes: `/api/users/create`, `/api/users/update`, `/api/users/delete`, `/api/users/list`,
  `/api/users/password`, `/api/users/profile`, `/api/users/current`
- Service: [`app/lib/services/users.ts`](../../app/lib/services/users.ts)

## Behavior

- New users are created with `mustChangePassword: true`. The protected layout redirects any
  session carrying that flag to `/change-password` before it renders anything else, so a seeded
  password cannot survive by being ignored.
- A new user starts with no system access and no organization — an operator grants system access
  explicitly on the edit form (see [`system-access.ts`](../../app/lib/services/system-access.ts))
  and links organizations separately, through `/api/organizations/admins/add` and
  `/api/organizations/admins/remove`.
- Organization membership lives in one place: `Users.organizationIds`. Linking someone from the
  Organizations page's "manage users" action and from the Users page's "manage organizations"
  action both call those two routes and write to the same field. There are no groups or roles
  beyond it: who can do what is decided by `systemLevel` (platform) and by membership (tenant).
- Profile routes use the **session's own user id** as the authority. A `userId` in the body is
  never trusted — that is the difference between editing your profile and editing anyone's.

## Restrictions

- `/system/*` is System/Support only, guarded once in
  [`app/(protected)/system/layout.tsx`](<../../app/(protected)/system/layout.tsx>) and again in
  every route behind it.
- `Users.systemLevel: ['system']` — the full platform bypass — can never be newly granted through
  this screen; only `scripts/dev/grant-system-access.ts` mints it. The toggle here can only grant
  `'support'`, and can never remove the caller's own access or the install's last System account.
  See [`system-access.ts`](../../app/lib/services/system-access.ts).

## Testing

- [`__tests__/server/users-admin-routes.spec.ts`](../../__tests__/server/users-admin-routes.spec.ts)
  and `user-profile-route.spec.ts` cover CRUD, the profile routes and the authority rules;
  `system-access-service.spec.ts` covers the `systemLevel` grant rules.
