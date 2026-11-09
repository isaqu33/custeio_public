# Stock (Estoque)

## Scope

The first domain screen: manual CRUD over `RawIngredients` (name, unit, current stock, average
cost, minimum alert threshold), scoped per `Store`. It exists so an owner can register their
ingredient catalog and a starting stock/cost baseline **before** `sefaz.nfe.received` and
`pos.order.received` exist to roll `currentStock`/`averageCost` forward automatically — see
[Stock and real CMV](./stock-and-cmv.md) for the design those two jobs will follow.

There is **no import from the POS**. The Alloy catalog API (`/api/catalog/*`, see
[Alloy API mapping](./alloy-api.md)) only exposes the sales cardápio — products, categories,
complementos — not raw ingredients or stock. Alloy has its own separate "Estoque & Ficha técnica"
module in its own product, but nothing in the public integrator API (the same Postman collections
`alloy-api.md` catalogs in full) exposes it.

**Two ways to populate `RawIngredients`** as of 2026-09-23:

1. **Manual** — the "Novo insumo" form (this doc's original scope).
2. **NFe capture** (`sefaz.nfe.received`, see [SEFAZ NFe](./sefaz-nfe.md)) — the "Enviar notas
   (XML/PDF)" button next to it opens `CaptureNfeDialog` (`components/capture-nfe-dialog.tsx`),
   which uploads one or more purchase invoices, each either the NFe's XML or its DANFE PDF (see
   [DANFE PDF capture](./sefaz-nfe.md#danfe-pdf-capture-not-only-xml) — the PDF path's item-line
   reading is best-effort, unlike the XML's exact schema read). The job
   (`app/jobs/sefaz-nfe-received.ts`, logic in `app/lib/services/nfe-capture.ts`) matches each line
   against `SupplierItemMappings` when it can, and otherwise auto-drafts a new ingredient (Tier 1)
   after checking for a similarly-named one to reuse instead (Tier 2) — see the job's own doc for
   the derivation. A drafted ingredient carries `isDraft: true` and a "Rascunho" badge in the table
   until edited and saved by hand.

3. **"Buscar na SEFAZ"** (added 2026-09-24) — same job, `mode: 'sefaz'`: the job pulls document
   batches itself instead of receiving files. The source is `SEFAZ_SOURCE`: `simulated` (default;
   replays `<NSU>-<schema>.xml` files from `SEFAZ_SIMULATED_DIR`, e.g. the 50 documents saved from
   the first production query — kept **outside git**, they are real invoices) or `live` (not wired:
   certificate custody is undecided, it fails loudly instead of serving fixtures as real). Only the
   `procNFe` documents go through the capture path above; `resNFe` summaries and events are counted
   as "ignored".

   - **Progress and logs** (the analysis pipeline's pattern): `progress.nfe` on the job (phase,
     `docsDone/docsTotal`, invoices captured/duplicate/failed, drafts…) is written as it runs;
     percent and time-left come from the pure `nfeSyncForecast` (`app/lib/jobs/nfe-sync-estimate.ts`;
     `docsTotal` is a real denominator — pending NSUs, capped by the per-run batch budget); step
     logs (`sync-start`, `sefaz-fetch`, `cursor-saved`, `batch-cap`, `sync-done`, `nfe-error`,
     `sefaz-blocked`) land in the job's `logs[]` and in pino with the `jobId` as `correlationId`.
     The Stock page shows the live card (`components/nfe-sync-progress.tsx`); so does the job detail.
   - **NSU cursor per store** (`Stores.sefazUltNsu`), saved after every batch: a second search — or
     a run that died halfway — continues instead of re-reading. At most 3 batches per run
     (`MAX_BATCHES_PER_RUN`); the next press continues.
   - **Guard against mashing the button** (`app/lib/sefaz-sync-gate.ts`,
     `app/lib/services/nfe-sync-claim.ts`): one run at a time per store; a cooldown since the last
     search (`SEFAZ_SYNC_COOLDOWN_MINUTES`, default 60 — safe while the "wait ~1h after cStat 137"
     rule is unconfirmed, see [SEFAZ NFe](./sefaz-nfe.md)); a stop while SEFAZ has the CNPJ blocked
     (656) or 15+ real calls in the last hour (margin under 20). `sefazLastSyncAt` is claimed with a
     conditional update, so two simultaneous clicks cannot both win. Refusals are HTTP 429 with the
     minutes left; the button shows the countdown. Simulated batches are logged in `sefaz_requests`
     (`simulated: true`) but **never count** toward the API-usage counter.

While a capture job is queued/running for the selected store, the table shows pulsing skeleton rows
(`CaptureLoadingRows` in `data-table-raw-ingredients.tsx`) instead of the real data — polled every
3s via `GET /api/raw-ingredients/capture/status`, the same page not needing a manual refresh once
it flips back to done.

**Deliberately out of scope for this first pass**: deleting an ingredient. Only list/create/update
exist — a wrong entry is fixed by editing it, not removing it, since nothing yet references
`RawIngredients` from a recipe (`PartnerProducts.recipe`) to make deletion unsafe, but the action
simply wasn't asked for.

## Store scoping

`RawIngredients` belongs to a `Store`, not an `Organization` — and one Organization (Cliente) can
have more than one Store (Loja). This is the first tenant-facing (`/organization/*`) page that
needs to pick _which_ store, so it introduced two new pieces:

- `getStoreOptionsForSession` (in [`app/lib/services/stores.ts`](../../app/lib/services/stores.ts))
  - `GET /api/organizations/stores/options` — the tenant-open equivalent of
    `getOrganizationOptionsForSession` / `/api/organizations/options`, scoped by the session's
    authorized organizations rather than requiring System access (unlike `getStoresForOrganization`
    / `/api/organizations/stores`, which backs the System store table).
- [`StoreScopeSelector`](../../components/store-scope-selector.tsx) — modeled on
  `OrganizationScopeSelector`, but with **no "all" option**: an ingredient always belongs to one
  concrete store, so the page always needs exactly one selected. The pick lives in the URL as
  `storeId`; a missing or unauthorized value falls back to the first available store and
  canonicalizes the URL to match.

A tenant with no `Store` yet (its PDV integration hasn't been set up — that's a System/Support
action today, see [POS providers](./pos-providers.md)) sees an explanation instead of an empty
table; there is nothing on this page to create one.

## Routes

- UI route: `/organization/stock`
- `GET/POST /api/organizations/stores/options` — `ORGANIZATIONS_GET_STORE_OPTIONS`, tenant-open
- `GET/POST /api/raw-ingredients` — `RAW_INGREDIENTS_GET_ALL`, resolves `storeId` → organization
- `POST /api/raw-ingredients/create` — `RAW_INGREDIENTS_CREATE`
- `GET/POST /api/raw-ingredients/movements` — `RAW_INGREDIENTS_GET_MOVEMENTS`, the history behind a balance
- `POST /api/raw-ingredients/count` — `RAW_INGREDIENTS_COUNT_STOCK`, an inventory count
- `POST /api/raw-ingredients/update` — `RAW_INGREDIENTS_UPDATE`, resolves the ingredient's own id →
  store → organization before trusting it
- `POST /api/raw-ingredients/capture` — `RAW_INGREDIENTS_CAPTURE_NFE`, enqueues `sefaz.nfe.received`
- `GET/POST /api/raw-ingredients/capture/status` — `RAW_INGREDIENTS_CAPTURE_NFE_STATUS`, polled by
  the page while a capture is in flight

## Behavior

- Server component (`page.tsx`); resolves the store list and the selected store's ingredients via
  the services directly (no client fetch on first load), per the layered-architecture rule in
  `CLAUDE.md`.
- Create/update happen client-side through `apiFetch`, then `router.refresh()` — the page re-runs
  server-side rather than the table re-fetching on its own.
- `currentStock`/`averageCost`/`minAlertStock` are freely editable today, including to a negative
  `currentStock` (see the "stock may go negative" decision in `stock-and-cmv.md`) — there is no job
  yet writing these fields that a manual edit could race with.

- **Search and pagination** are server-side, like the other listing screens: `?q=` narrows by
  ingredient name (case-insensitive contains, regex-escaped) and `?page=` pages 20 at a time, with
  the total count beside the page links. The page links keep `storeId`/`organizationId`/`q`. A page
  emptied by a search or a change falls back to the previous one.
- **Summary strip** above the table (`components/stock-summary-cards.tsx`, numbers from
  `getStockSummaryForStore` in `app/lib/services/stock-summary.ts`): stock value, ingredients (and
  drafts), items under their minimum alert / out of stock, captured invoices and their total,
  mapped supplier items, latest invoice date. Computed over the whole store — a search or page does
  not change them — and refreshed with the page after a capture. Stock value counts a negative
  balance as 0.
- **Cost display**: `averageCost` is per stock unit, so a gram or millilitre costs fractions of a
  cent; it renders up to 4 decimals below R$ 1 with the unit ("R$ 0,0076 / g").
- **Draft units from the product name** (`packSizeFromDescription` in `nfe-capture.ts`): when the
  NFe only says UN/PC, a count in the name ("OVO 30UNI") becomes `un` with that factor, and a bulk
  weight from 1 kg up ("ARROZ 5KG") becomes `g`. Smaller weights, volumes (bottles and cans are
  counted, not poured), multi-packs ("CX", "6 x 350ml", "c/12") and names with two different
  weights stay as whole units. Only when the commercial and tax units agree.
- **Reload**: the table toolbar has a refresh button, like every other table.
- **Export CSV** (`GET /api/raw-ingredients/export`): the whole store, or what the search narrows it
  to, as an Excel-ready file (`;` separator, decimal comma, UTF-8 BOM) — see [Products](./products.md#csv-export).

## The ledger (`stock_movements`)

`RawIngredients.currentStock` is a running balance, and a bare balance cannot answer "why is there
5 kg of sugar?". Every change of it is now also a row in `stock_movements`
([model](../../app/models/stock-movements.ts)):

- **`purchase`** — one NFe line applied by `sefaz.nfe.received`: invoice access key, number and
  series, supplier (CNPJ and name — the trade name when there is one), the supplier's own
  description, the invoice's **issue date** as `occurredAt`, the quantity in the ingredient's unit
  and the **landed** unit cost and value.
- **`adjustment`** — a person set the balance: an inventory count, a manual edit of "Estoque atual",
  or the initial balance typed into "Novo insumo". Keeps the balance before and after, a note and who.
- **`sale`** — reserved for `pos.order.received`; nothing writes it yet.

The ledger is also what makes a capture **safe to re-run**. A purchase movement is unique per
invoice line (`source.invoiceAccessKey` + `source.itemIndex`) and is written **before** the stock is
credited: if a run dies halfway through an invoice (the invoice is only marked processed at the
end), the next run finds the lines already done and skips them instead of crediting twice; if the
credit itself fails the movement is taken back so the retry can apply it. (Mongo here is standalone,
so no transaction.)

`RawIngredients.lastPurchase` (date, supplier, invoice number, quantity, unit cost of the most recent
purchase) is a copy for the table, updated inside the same atomic update that credits the stock. It
only ever moves **forward in time**: an older invoice captured later does not replace a newer one.
`ProcessedInvoices` now keeps the supplier, number, series, Σ items and what the total adds on top,
so "which invoice was this" no longer needs the XML, which is not kept.

## What the table shows

- **Saldo estimado**, not "Estoque atual". Until `pos.order.received` debits sales, the balance is
  only the purchases that were captured (plus adjustments): a 5 kg sack bought six weeks ago is
  still counted. The header says so in a tooltip, and **"Contar estoque"** (scale icon) lets the
  owner set the balance to what is on the shelf; purchases add on top from there and the difference
  goes in the ledger.
- **Quantities and costs the way people read them.** Storage stays g/ml/un; the screen shows
  `5 kg` instead of `5000 g` and `R$ 2,50 / kg` instead of `R$ 0,0025 / g`
  ([`quantity-format.ts`](../../app/lib/quantity-format.ts)). The form types and shows kg/L and
  converts, so the state stays in storage units and switching the unit never silently changes a
  number. Costs are rounded to 8 decimals on every write (the weighted average left dust like
  `0,0024980000000000002` in forms and exports).
- **Última compra**: the invoice's date and the supplier, with number, quantity and cost in the tooltip.
- **Histórico de compras** (clock icon): every purchase and adjustment, newest first, with the
  supplier, invoice, quantity, unit cost and how the price **moved from the previous purchase**
  (in a real batch 15 of 39 repeated items changed price between purchases; the weighted average
  hides that). `GET /api/raw-ingredients/movements`.
- **Tipo** and **Usado em**. An ingredient is `food`, `packaging`, `cleaning` or `other`, guessed
  from the NFe description by keywords ([`ingredient-naming.ts`](../../app/lib/ingredient-naming.ts),
  no AI) and editable. Only food and packaging are "operation": cleaning products, a razor or a
  receipt roll stay out of the stock value and the low-stock alerts (the strip says how many are
  outside). "Usado em N produtos" counts the active products whose recipe, or a complement's recipe,
  uses it; both are filters (type, and in a recipe / in no recipe).
- **Cleaner names**: the supplier's unit suffix is dropped (`ACUCAR CRISTAL PEROLA 5KG UN0-5KG` →
  `Acucar Cristal Perola 5kg`) while a real count survives (`OVOS 30 UN`).
- **Fornecedores** in the summary strip, and the CSV export gains type, last purchase, supplier,
  invoice, usage, and reads in kg/L/un.

## Restrictions

- Open to any authenticated session with at least one `Store` in an authorized organization — no
  feature gates the page itself, same reasoning as Dashboard.
- Every route resolves the caller-supplied id's owning organization (`storeId` → org, or ingredient
  id → `storeId` → org) and calls `requireOrganizationAccess` before touching anything, the same
  pattern the Stores update/delete routes use.
- **The organization scope bar never renders for a tenant session** (fixed 2026-09-27 —
  `OrganizationWorkspaceFrame` now takes `hasSystemAccess` and short-circuits when false). A
  tenant has exactly the organizations `Users.organizationIds` gives it and no notion of "scope"
  to switch; showing "todas as organizações" on this page read as platform-wide to someone who
  should never be offered that concept, even though the data underneath was already correctly
  scoped (`getStoreOptionsForSession` filters by the session's own authorized organizations,
  never the client-supplied one — an unauthorized `organizationId` matches nothing, not
  "everything"). Only a System/Support session, already able to reach every organization,
  legitimately picks one here.

## Testing

- `__tests__/server/page-guards.spec.ts` — page guard + the two tenant-open routes in
  `OPEN_ROUTES`.
- `__tests__/client/app-sidebar-order.spec.ts` — sidebar placement.
- `__tests__/server/raw-ingredients-service.spec.ts`, `raw-ingredients-routes.spec.ts` — CRUD
  service and route behavior, including the duplicate-name conflict and the 404s from an unknown
  store/ingredient.
- `__tests__/server/store-options-service.spec.ts`, `store-options-route.spec.ts` — the store
  picker's scoping.
- `__tests__/server/stock-summary-service.spec.ts` — the summary aggregates.
- `__tests__/server/stock-movements-service.spec.ts`, `ingredient-usage-service.spec.ts`,
  `ingredient-ledger-routes.spec.ts`, `quantity-format.spec.ts`, `ingredient-naming.spec.ts` — the
  ledger, usage, the two new routes, display formatting, name cleanup and kind guesses.
- `__tests__/server/nfe-xml.spec.ts`, `nfe-capture-service.spec.ts`,
  `raw-ingredients-capture-routes.spec.ts`, `sefaz-nfe-received-job.spec.ts` — the capture job, end
  to end from XML parsing through Tier 1/2 to the job's own progress numbers.

## "Registrar compra" (manual purchase)

For a purchase whose note the app cannot capture — an NFC-e of a supplier that still issues one, a
receipt, a purchase with no note — the owner types it in: supplier, date, and per ingredient the quantity
and the cost of one unit (the cost starts at the ingredient's current average, so a repeat purchase only needs
the quantity). It is the only place the split by ingredient exists: the meat supplier's NFC-e is a single
"CARNE R$ 1.000" line (see [sefaz-nfe.md](./sefaz-nfe.md#blind-spot-nfc-e-purchases-model-65-are-invisible-to-this-whole-pipeline)).

- Button "Registrar compra" on the Estoque toolbar (`components/register-purchase-dialog.tsx`); route
  `POST /api/raw-ingredients/purchase`; logic in `app/lib/services/manual-purchase.ts`.
- Each line credits the ingredient exactly like an invoice line (`creditRawIngredientPurchase`: balance,
  weighted-average cost, "last purchase") and is kept in the ledger as a `purchase` with no invoice, carrying the
  supplier, the optional note, who typed it and a `manualBatchId`.
- **Double submit safe**: the dialog sends one `requestId` per opening, and a unique index on
  `(source.manualBatchId, source.itemIndex)` makes a repeat skip the lines already credited. The movement is
  written before the credit and taken back if the credit fails, like the invoice path.
- Typed in kg/L/un, stored in g/ml/un. Every ingredient must belong to the store; an ingredient appears once.
- Not built: editing or deleting a registered purchase (a wrong one is corrected with a count or an
  adjustment), attaching the receipt photo, reading the NFC-e QR code to prefill, a purchase total to
  reconcile against the lines.

## Ideas for the ingredients screen (not implemented)

A running list of improvements to `/organization/stock`, collected 2026-09-25. **Status
(2026-09-26):** idea 1 is built in the simple form described under "What the table shows" (a type
guessed by keywords plus "used in N products" from the recipes — the recipe-based rule, without
the AI inference); idea 2 and the items under "Not built" below are still only a direction.

### 1. Tell operation ingredients from everything else, using the Alloy menu

**Problem.** NFe capture (`sefaz.nfe.received`) drafts an ingredient for _every_ line of _every_
purchase invoice, so the table also fills with things that are not inputs to what the store sells:
an energy drink bought for the owner, a bag of beans at a burger place, cleaning supplies. Today
they all look the same as the real ingredients.

**Idea.** Ask Alloy what the store actually sells (the catalog API already used by
`pos.catalog.sync`: products, categories, complementos — see [Alloy API mapping](./alloy-api.md))
and use that as the reference for "what this store does" (pizza, burgers, ...). Ingredients are then
classified against it, and the table gets **tags to filter by**, e.g. _operation input_ vs. _not
operation_.

**Open points.**

- How the match is made: only through `PartnerProducts.recipe` (an ingredient that appears in some
  recipe is an operation input by definition), or also by inference for ingredients not yet in any
  recipe (name/category similarity against the menu, or the AI layer from
  [Upcoming Implementations](../upcomingImplementations.md) §1). The recipe-based rule is cheap and
  exact but only works once recipes are filled in; the inference is what would help at onboarding.
- The tag should be a suggestion the owner can override, not a hard rule — a wrong "not operation"
  would hide a real input from stock/CMV.
- Whether "not operation" ingredients should still receive stock/cost updates from NFe or be left out
  of `pos.order.received`/CMV entirely (they have no recipe to consume them anyway).

### 2. Consolidated view across stores, with per-store breakdown

**Problem.** A Cliente (Organization) can have several Stores, and `RawIngredients` belongs to a
Store. Three cheeses bought at three different stores are three unrelated rows, so the owner has no
single "how much cheese do I have" number.

**Idea.** Show one row per ingredient at the Cliente level, with the quantity summed across its
Stores. Clicking the row opens the detail: **each Store and how much it contributes** to the total.

**Open points.**

- There is no shared identity across Stores today. The same-ingredient decision would need either
  the Tier 2 name-similarity dedupe from [SEFAZ NFe](./sefaz-nfe.md) applied across Stores, or an
  explicit canonical ingredient (an Organization-level entity the per-Store rows point to). The
  first is cheaper; the second is more reliable.
- Unit consistency: rows can only be summed when they share `g`/`ml`/`un`.
- Weighted average cost across stores is a separate question from summing the balance — see
  [Stock and real CMV](./stock-and-cmv.md).
- Interaction with the current `StoreScopeSelector`, which has no "all" option by design: this view
  would be the first place a page reads across Stores.

### Not built yet

- **Consolidated view across stores** (idea 2): needs an identity for "the same ingredient" across
  stores; do the ledger and the naming cleanup first, then decide between the Tier 2 name match and
  a canonical ingredient.
- **A suppliers page**: spend per supplier, invoices, price comparison between suppliers for the same
  item. The data is there now (supplier on every movement and invoice).
- **Alerts** built on the ledger: "no purchase for X days", "price rose X% since the last purchase".
- **Sales debiting the balance** (`pos.order.received`): until it exists the balance is an estimate.
