# Products (Produtos)

## Scope

The Alloy menu mirrored per store, with the recipe ("ficha técnica") of each item and the cost and
margin that follow from it. `/organization/products`, tenant-facing, same shape as
[Stock](./stock.md): pick a store, a slim summary strip, search, pagination, refresh, "Exportar
CSV". Nothing here creates a product — the menu belongs to Alloy; what a person writes is the
recipe.

It is the link between what the store buys ([Stock](./stock.md), from NFe) and what it sells
(`pos.order.received`, [Stock and CMV](./stock-and-cmv.md)): without a recipe a sold item cannot
debit ingredients.

## `pos.catalog.sync`

"Sincronizar cardápio" enqueues the job for the selected store. Alloy allows **2 requests per
minute per store token** ([Alloy API](./alloy-api.md)), so the whole design is about spending one:

- **One request per sync.** `GET /api/catalog/getproducts` returns the entire menu — categories,
  items, complement groups and complements — so there is no `getitem` per product. (Measured
  2026-09-26 on a real store: 82 items, 843 complements, ~470 KB in one answer.)
- **The request is reserved before it is made** (`reserveAlloyRequest`, shared with "Testar
  conexão" and every future Alloy call for the store). If the budget is spent the job does not call
  Alloy and fails as _retryable_.
- **Retry waits out the window:** 3 attempts, fixed 65 s backoff. A 429 from Alloy is treated the
  same way and leaves the store's status alone (the token is fine, only the quota is spent).
- **Cooldown per store** (`ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES`, default 10), claimed with a
  conditional update on `Stores.catalogLastSyncAt` so two clicks cannot both win, plus one run at a
  time. The button shows the countdown. Manual only — no scheduler yet.
- **Failures that a retry cannot fix are permanent:** the token rejected by Alloy (HTTP 200 with
  `status: "error"`; the store is flagged like the health check does), a store without Alloy, an
  unreadable stored key.
- **What it writes** (`app/lib/services/catalog-sync.ts`): an upsert of `PartnerProducts` by
  `(storeId, externalId)`, `externalId` being the Alloy item **id** — `cod_pdv` repeats across items
  and is not a key. Alloy owns name, category, price, promotional price (only while the promotion
  is on), active flag and the complements; **a person owns `recipe`**, so it is only ever set to `[]`
  on insert, and each complement gets its previous recipe back by external id (overwriting the
  `modifiers` array would erase them). An item Alloy stops listing is kept and marked inactive
  (`lastSeenAt` older than the run) — recipes and past orders point at it. An empty answer never
  switches the menu off.
- **Active** means the item, its category and the category's visibility all say so. In the real
  store 39 of 82 items are active; the rest are hidden copies for iFood integrations.

The steps of a run (in Portuguese) land in the job's `logs[]`; the job detail shows them. The Produtos
page polls `GET /api/products/sync/status` only while a run is in flight, then toasts the result
(created / updated / deactivated, or the failure reason).

## The table

Columns: product (badges for inactive and promotion, complement count), category, price (the
promotional price with the list price struck through), cost, margin (R$ and %), recipe (items, or
"Sem ficha"), edit. Status filter defaults to **active**.

- **Cost** = Σ recipe quantity × the ingredient's average cost (`computeProductEconomics`). Without
  a recipe it is empty, never 0. A line whose ingredient has no cost yet (or was deleted) marks the
  cost **incomplete** (⚠): the real cost is higher than shown, and the product is left out of the
  average margin.
- **Margin** uses the promotional price while a promotion is on.
- **Summary strip** (store-wide, unaffected by search/page): active products (and inactive), with /
  without recipe, average price, average margin (only complete recipes), last sync.

## Recipe editor

`POST /api/products/recipe`. One line per ingredient, quantity **per one unit of the product**, in
the ingredient's own unit (g, ml, un). The dialog shows cost and margin live from the ingredients'
current average cost. Rules enforced server-side: no ingredient twice, every ingredient must belong
to the product's store, quantity > 0, at most 60 lines. Every save is audited.

**Not built:** recipes for **complements**. Alloy copies every complement per item (the same "Ao
ponto" has a different id under each burger: 843 rows, 45 distinct names), so the model stores them
per product and the sync preserves them, but there is no editor yet — setting "Bacon extra" 20 g on
every burger by hand is not acceptable. The likely design is a store-level recipe per complement
name, applied to every copy.

## CSV export

`GET /api/products/export` and `GET /api/raw-ingredients/export` (the Estoque button): the whole
store, or what the current search (and, for products, status) narrows it to — not just the page on
screen. Built for Excel pt-BR: `;` separator, decimal comma, UTF-8 BOM, `.csv` named with the day
(São Paulo time). Text that comes from outside (an Alloy name, a supplier description) is defused
against spreadsheet formulas (`=`, `+`, `-`, `@` get a leading `'`). Each export is audited.

## Restrictions

Same as [Stock](./stock.md#restrictions): open to any session with a `Store` in an authorized
organization, every route resolves `storeId`/product id → organization before touching anything,
and the scope bar only renders for System/Support.

## Routes

- UI: `/organization/products`
- `POST /api/products/sync` — `PRODUCTS_SYNC_CATALOG`
- `GET/POST /api/products/sync/status` — `PRODUCTS_SYNC_STATUS`
- `POST /api/products/recipe` — `PRODUCTS_UPDATE_RECIPE`
- `GET /api/products/export` — `PRODUCTS_EXPORT_CSV`
- `GET /api/raw-ingredients/export` — `RAW_INGREDIENTS_EXPORT_CSV`

Every route resolves the caller-supplied id to its store and organization and calls
`requireOrganizationAccess` before touching anything.

## Testing

- `alloy-catalog.spec.ts` — the parser and `fetchAlloyCatalog` (synthetic fixture shaped like the
  real payload; nothing real is committed).
- `catalog-sync-service.spec.ts` — the request is reserved before Alloy is called, quota failures
  are retryable, rejections are permanent, recipes survive the upsert, nothing is deleted.
- `catalog-sync-claim.spec.ts` — the cooldown and its atomic claim.
- `products-service.spec.ts`, `products-routes.spec.ts`, `csv.spec.ts`.
