# Stores

## Scope

The Loja: one CNPJ, one Alloy (or other PDV) account — 1:1, not N per CNPJ. One
[Organization](./organizations.md) (Cliente) has many Stores, e.g. a client running two
physical restaurants under two different CNPJs, each with its own Alloy connection. All
domain data — stock (`RawIngredients`), menu (`PartnerProducts`), sales (`Orders`), the NFe
De/Para (`SupplierItemMappings`) and fiscal idempotency (`ProcessedInvoices`) — is scoped by
`storeId`, not `organizationId`, since stock/menu/sales are per physical loja, not shared
across a Cliente's stores.

## Routes

- UI: the "Configurar integração PDV" action on the Organizations table
  (`components/table-organization.tsx` → `ModalOrganizationStores` →
  `DataTableOrganizationStores` / `StoreFormDialog`)
- API routes: `/api/organizations/stores` (list), `/create`, `/update`, `/delete` — all
  System/Support only, like everything under `/system`
- Service: [`stores.ts`](../../app/lib/services/stores.ts)
- Model: [`app/models/stores.ts`](../../app/models/stores.ts)

## What a store holds

- **Fiscal identity** — `cnpj` (required, unique across the whole collection — this is the
  sole uniqueness guard, since 1 CNPJ = 1 Alloy account), `legalName` (razão social,
  optional), `name` (nome fantasia, required — the primary display name in the UI).
- **WhatsApp** — `whatsappNumber`, the store manager's number for WhatsApp (Meta Cloud API) stock/CMV
  alerts (not yet sent by any job).
- **PDV connection** — `provider` (enum: `alloy`, `consumer`, `saipos`, `grandchef`,
  `anota_ai` — only `alloy` is actually wired up today, see
  [POS providers](./pos-providers.md)), `externalId` (the provider's own store id — Alloy's
  `loja_id`), `apiKey` (the "Token da loja", Bearer — write-only, never selected back to the
  client, and **encrypted at rest** with AES-256-GCM via
  [`secret-encryption.ts`](../../app/lib/secret-encryption.ts) before it's saved; decrypted
  only by `getDecryptedStoreApiKey` for an actual provider call, e.g. a future
  `pos.catalog.sync`/`pos.order.received` job — requires `APP_SECRETS_ENCRYPTION_KEY` to be
  set, see `.env.example`), `imageUrl` (set by hand; no Alloy endpoint returns a store photo).
- **Connection health** — `status` (`connected` / `error` / `disconnected`, default
  `disconnected`), `lastHealthCheckAt`, `lastError`, `lastSyncAt` — set by a health check /
  sync job hitting the provider API, not by the operator. No job populates these yet.

## Immutability

`cnpj`, `provider` and `externalId` are the store's identity and are locked once it exists —
the create form is the only place they're set; the edit form only exposes `name`, `legalName`,
`whatsappNumber`, `apiKey` and `imageUrl`. Changing a CNPJ or provider connection is modeled as
deleting the store and creating a new one, not an edit.

## Restrictions

- System/Support only, like everything under `/system`.
- Deleting a store does not cascade-delete its domain data (`RawIngredients`,
  `PartnerProducts`, `Orders`, `SupplierItemMappings`, `ProcessedInvoices`) — that cleanup is
  not built yet.
- No job populates `status`/`lastHealthCheckAt`/`lastSyncAt`/`lastError` yet — those fields
  exist for when `pos.catalog.sync` and a health-check job are built.

## Testing

No dedicated route/service tests exist yet for Stores (the CRUD routes mirror the pattern
already covered by `organizations-routes.spec.ts`). Add them alongside the first real
`pos.catalog.sync`/`pos.order.received` job work. `apiKey` encryption itself is covered by
[`secret-encryption.spec.ts`](../../__tests__/server/secret-encryption.spec.ts).
