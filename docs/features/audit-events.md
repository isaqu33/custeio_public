# Audit events

## Scope

Who did what, and when, on the platform. Read-only by design: audit rows are written by the routes
that perform the action, never by hand, and nothing in the product edits or deletes one.

It is a **System/Support tool**, not a tenant screen: an operator reads it to answer "who changed
this client's billing?" — the tenant itself has no audit view.

## Routes

- UI route: `/system/audit-events`
- Backend feature: `audit_events.get` → `/api/audit-events`
- Service: [`app/lib/services/audit-events.ts`](../../app/lib/services/audit-events.ts)
  (`listAuditEventsForSession` to read) and
  [`app/lib/services/audit-log.ts`](../../app/lib/services/audit-log.ts) (`logAuditEvent` to write,
  re-exported from the first for existing callers)
- Model: [`app/models/audit-events.ts`](../../app/models/audit-events.ts)

## What a row carries

- `source` — `ui` | `api` | `external-api` | `worker` | `system`. The same action reached through
  the admin UI and through an API is the same `action` with a different source, so a filter by
  action does not have to know which door was used. The webhook-driven jobs to come
  (`pos.order.received`, `whatsapp.message.incoming`) are what `external-api` and `worker` are for.
- `outcome` — `success` | `failure`. Failures are recorded too; an audit log that only holds what
  worked cannot answer "did someone try".
- Actor, organization, action, resource, timestamp, and a message with the action's own detail.

**Writing is a separate module from reading.** The read side needs the session and the
authorization stack to decide what a viewer may see; writers are the opposite — a worker, or a
service answering a webhook, has no session, and importing one would drag NextAuth into every
service that records an event.

`logAuditEvent` accepts a **null actor** and renders it as "System": there is no machine
"Integration" account, because there is no login for an action nobody signed.

## What gets recorded today

Every action below is written by its route, `source: 'ui'`, with the acting user:

| Action                                                                                | Route                                               |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `organization.update`, `organization.toggle_status`, `organization.update_billing`    | `/api/organizations/{update,status,billing/update}` |
| `organization.generate_invite_token`, `organization.revoke_invite_token`              | `/api/organizations/invite-token{,/revoke}`         |
| `organization.create_store`, `organization.update_store`, `organization.delete_store` | `/api/organizations/stores/*`                       |
| `users.inspect`, `users.reset_password`                                               | `/api/users/{inspect,reset-password}`               |
| `job.retry`, `job.export_download`                                                    | `/api/jobs/[id]/{retry,download}`                   |

## Behavior

- Filters: date range (default: the last 15 days, so an unfiltered first load never scans
  everything ever logged), action, and a free-text search over the actor's name and email. The
  action list in the filter is built from the actions actually present in scope, so it never
  offers a value that returns nothing.
- Organization is **not** a filter on the page: it comes from the organization scope bar in the
  page header, and narrows the query the same way `?organizationId=` does on the API.
- Newest first, paginated at 20 (API cap 100).
- An audit write that fails is logged and swallowed — it must never fail the action it records.
  A store created but unaudited is bad; a store creation that 500s because auditing broke is worse.

## Restrictions

- System/Support only. Guarded once in
  [`app/(protected)/system/layout.tsx`](<../../app/(protected)/system/layout.tsx>) and again in the
  route (`requireSystemAccess`), because the layout shapes the UI and the route shapes the request.
- Still bounded by `getAuthorizedOrganizationIds`: an `organizationId` from the client only ever
  narrows the set, never widens it.
- There are no groups or per-feature grants any more: access to `/system/*` is decided by
  `Users.systemLevel` alone.

## Testing

- [`__tests__/server/audit-events-service.spec.ts`](../../__tests__/server/audit-events-service.spec.ts)
  covers listing, filters and the null-actor path.
