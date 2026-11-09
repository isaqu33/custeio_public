# Feature specs

This folder documents product behavior page by page. Treat these files as the human-readable
companion to the typed registry:

- [`app/lib/features.ts`](../../app/lib/features.ts) defines backend capabilities, endpoints,
  risk, and whether a feature is role-managed.
- `docs/features/*.md` explains product intent, page behavior, restrictions, and testing
  expectations.

## New feature checklist

Every new product feature should include the implementation, documentation, and tests in the
same change:

1. Update the relevant page spec in this folder.
2. Add or update the backend feature in `app/lib/features.ts` when an API capability is involved.
3. Add unit tests for business rules and client behavior.
4. Add stable `data-e2e-id` selectors for workflow-critical buttons/forms.
5. Add or update e2e coverage for the main action path when the feature affects real workflows.
6. Follow the conventions in `CLAUDE.md`: `apiFetch` for client calls, typed
   errors from `app/lib/errors.ts` inside `withObservability` routes, `requireOrganizationAccess`
   on organization-scoped routes (and every domain query scoped by `organizationId`/`storeId`),
   zod schemas for validation, and localization dictionaries for user-facing copy.

## Sidebar order

Two groups, in this order: **Usuário** (what a tenant works with) and **System** (platform
administration). Today Usuário holds Dashboard, Products and Stock; System holds Audit events, Crons,
Jobs, Organizations and Users. The entries inside each group are sorted alphabetically by the
**active locale's** label, in [`components/app-sidebar-nav.ts`](../../components/app-sidebar-nav.ts)
— a list hand-sorted in English reads as unsorted in pt-BR. Adding a page means adding its entry;
where it lands is not a decision to make. `__tests__/client/app-sidebar-order.spec.ts` guards it.

## Access model

One rule: `/system/*` is **System/Support only**, decided by `Users.systemLevel` — no per-feature
grant, no group, no role (groups and organization API tokens were removed). Guarded once in
[`app/(protected)/system/layout.tsx`](<../../app/(protected)/system/layout.tsx>) — a non-System
session is redirected to `/` — and again in every route behind it (`requireSystemAccess`), because
the layout shapes the UI and the route shapes the request.

`/organization/*` pages are open to any authenticated session scoped to an organization; nothing
there is feature-gated today (see `NAV_REQUIRED_FEATURE` in
[`app/lib/landing.ts`](../../app/lib/landing.ts), which is empty on purpose — it is where a gated
`/organization` page would register itself if one existed).

`__tests__/server/page-guards.spec.ts` walks the route tree and fails on anything unguarded, so
this stays true without anyone remembering it.

## Page specs

Usuário (tenant-facing):

- [Dashboard](./dashboard.md) — placeholder previewing stock value, CMV, margin and low-stock
  alerts; no data until the domain jobs exist
- [Stock (Estoque)](./stock.md) — manual CRUD over `RawIngredients` per store, ahead of the
  NFe/POS jobs that will roll `currentStock`/`averageCost` forward automatically
- [Products (Produtos)](./products.md) — the Alloy menu per store (`pos.catalog.sync`), the recipe
  of each item, cost and margin, CSV export

System (platform administration, System/Support only):

- [Jobs](./jobs.md) — the support console for the Bull queue; the two CSV reports that exist and
  the four domain jobs that do not yet
- [Users](./users.md)
- [Organizations](./organizations.md) — the Cliente: the paying customer, holding users and billing
- [Audit events](./audit-events.md)

Domain and integrations (cross-cutting; mostly specs for things **not built yet**):

- [Stores](./stores.md) — the Loja: one CNPJ, one Alloy account, and the domain data scoped by
  `storeId`
- [POS providers](./pos-providers.md) — which platforms `Stores.provider` supports, what's
  actually wired up vs. reserved for expansion, and why credentials live per store
- [Alloy API mapping](./alloy-api.md) — routes, auth, and webhooks for the one POS provider
  that's actually wired up (`pos.catalog.sync`, `pos.order.received`)
- [SEFAZ NFe distribution](./sefaz-nfe.md) — the direct-to-government webservice for capturing
  purchase invoices, chosen over an aggregator (FocusNF/Arquivei); certificate requirements,
  distribution + manifestation flow, rate limits (`sefaz.nfe.received`)
- [Stock and real CMV](./stock-and-cmv.md) — how a purchase credits `RawIngredients` (weighted
  average cost) and a sale debits it via `PartnerProducts.recipe`/modifiers, fixing each
  `Order`'s real CMV and margin
- [WhatsApp quick query and alerts](./whatsapp-quick-query.md) — official Meta Cloud API chosen
  over Evolution API, one shared Custeio number routed by `Stores.whatsappNumber`, the 24h
  window vs. the October 2026 pricing change, and the open AI-vs-fixed-commands decision
  (`whatsapp.message.incoming`)
- [Billing and client invoicing](./billing.md) — Asaas for Custeio's own subscription
  charges, why a MEI billing a CNPJ client must issue NFS-e (no exception), and the open
  question of whether billing belongs on `Organization` or `Store`
- [Email](./email.md) — not needed for anything that exists today (auth is credentials-only, the
  client channel is WhatsApp), but needed for formal/LGPD notices; Azure Communication Services
  recommended over Resend/SES to stay on the same cloud vendor

Platform:

- [Architecture](../architecture/) — topology, Redis/Mongo roles, the four planned jobs, the
  ceilings; PDF plus the short written version
- [Localization](./localization.md)
- [No access](./no-access.md)
