# Organizations

## Scope

The Cliente: the paying customer, holding users and billing. An Organization has no CNPJ of
its own — a Cliente can own multiple [Stores](./stores.md) (Lojas), each one its own CNPJ with
its own Alloy account. Every other page (Jobs, Users) scopes itself by the set of
organizations the session may reach; domain data (stock, recipes, sales) is scoped one level
down, by `storeId` — see [Stores](./stores.md).

## Routes

- UI route: `/system/organization`
- API routes: `/api/organizations/create`, `/update`, `/delete`, `/list`, `/options`,
  `/status`, `/users`, `/admins`, `/admins/add`, `/admins/remove`, `/invite-token`,
  `/invite-token/view`, `/invite-token/revoke`, `/billing/update`
- Services: [`organizations.ts`](../../app/lib/services/organizations.ts),
  [`organization-admin.ts`](../../app/lib/services/organization-admin.ts),
  [`organization-scope.ts`](../../app/lib/services/organization-scope.ts)
- Model: [`app/models/organizations.ts`](../../app/models/organizations.ts)

## What an organization holds

- **Identity** — `name` only. Fiscal identity (CNPJ, razão social) and PDV/WhatsApp
  credentials live per Store, not here — see [Stores](./stores.md).
- **Onboarding** — `status`: `onboarding` (default, set by the salesperson who creates the
  account) → `active` → `suspended` / `canceled`. `inviteToken` lets the store owner claim
  the account a salesperson created for them; it is **not** generated at creation — it's
  issued on demand from the table's "Generate invite link" action (`POST /invite-token`).
  Unlike a real secret, it's stored in plaintext on purpose (it must be claimable later, so
  it can't be a one-way hash) — `POST /invite-token/view` reveals the current one again
  without replacing it, and `POST /invite-token/revoke` clears it. There is no claim/redeem
  flow built yet — only issuing and managing the token.
- **Billing** — `asaasCustomerId` (for Asaas invoicing/NFS-e) and `billingStatus`
  (`up_to_date` / `past_due`). There is no Asaas integration yet: the "Manage billing" action
  (`POST /billing/update`) is a manual record for Support to set both fields by hand in the
  meantime, not an automated one. `billingStatus` is intended to gate whether an
  organization's Bull jobs keep running once real enforcement exists.

## No admin/member distinction

An organization has no `admins` field, and a linked user has no role within it either — there
is one kind of end user in Custeio, so every user linked via `Users.organizationIds` sees the
same screen. `POST /admins/add` just adds the id to that array; `POST /admins/remove` pulls it.
The only thing `GET /admins` flags per row is `bypassesOrganizationScope` — whether the user
also carries System/Support access (see
[`system-access.ts`](../../app/lib/services/system-access.ts)) and so can see every organization
regardless of this link, which is real information a plain member list would hide.

## The scope bar

[`resolveOrganizationScope`](../../app/lib/services/organization-scope.ts) is the single place
the narrowing rule lives: the session's authorized organizations are the ceiling, and an
`organizationId` from the URL only ever narrows that set. An unknown or unauthorized id resolves
to an **empty** scope, never to "everything" — in a multi-tenant app that is the failure mode that
matters.

## Restrictions

- System/Support only, like everything under `/system`.
- Creating one links the creator via `Users.organizationIds` only (no second array to keep in
  sync — see "No admin/member distinction" above).
- The status toggle (`POST /status`) only ever flips `active` ↔ `suspended`; `onboarding` and
  `canceled` are reached through other flows (claim, cancellation), not this action.
- Suspending an organization does not yet stop anything at runtime — there is no live
  integration endpoint (Alloy webhook, `pos.order.received` job) enforcing `status` or
  `billingStatus` today. The fields exist for when that pipeline is built.
- Deleting an organization pulls it from every linked user's `organizationIds`. It does not
  cascade-delete its Stores or their domain data — that cleanup is not built yet.

## Testing

- [`__tests__/server/organizations-routes.spec.ts`](../../__tests__/server/organizations-routes.spec.ts),
  `organizations-options-route.spec.ts`, `organization-admin-service.spec.ts`,
  `organization-users-route.spec.ts`, `organization-scope-service.spec.ts`,
  `user-organization-scope.spec.ts`.
- `__tests__/server/authorization.spec.ts` covers the tenant boundary itself.
- `__tests__/server/jobs-export-organizations.spec.ts` covers the CSV export.
- No dedicated route tests exist yet for `/invite-token/view`, `/invite-token/revoke` or
  `/billing/update` — they mirror the pattern already covered for `/status` and
  `/invite-token`. Add them if this area gets real behavior (Asaas integration, an actual
  claim/redeem flow) rather than staying a manual/plaintext-reveal shell.
