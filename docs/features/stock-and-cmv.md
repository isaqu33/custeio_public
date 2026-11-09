# Fractional stock deduction + real CMV

How a purchase (NFe) credits stock and how a sale (Alloy) debits it — step 3 of the pipeline
described in `CLAUDE.md`: "deducts fractionally based on the products' recipes
(including add-ons)". This document covers the logic of `sefaz.nfe.received` (the half that
credits) and `pos.order.received` (the half that debits and calculates the real CMV).

> Written on 2026-09-18 from the design already encoded in the comments of the current models
> (`RawIngredients`, `PartnerProducts`, `Orders`, `SupplierItemMappings`, `ProcessedInvoices`) —
> at that date neither job existed. **Update 2026-09-29:** the crediting half (`sefaz.nfe.received`, purchases → `StockMovements`/`averageCost`) is implemented; the debiting half (`pos.order.received`, sales → real CMV) is still not. See [current state](../architecture/current-state.md). The reconciliation layer built on top of this is in [`domain/cmv-reconciliation.md`](../domain/cmv-reconciliation.md). See
> [Open / pending decisions](#open--pending-decisions) for what is still to be decided before
> coding.

## Models involved

| Model                                                                | Role in this flow                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`RawIngredients`](../../app/models/raw-ingredients.ts)              | `currentStock` (balance) and `averageCost` (weighted average cost) per ingredient, per `Store`                                                    |
| [`PartnerProducts`](../../app/models/partner-products.ts)            | `recipe` (the recipe) and `modifiers[].recipe` (the micro-recipe of each add-on), entered by hand — `pos.catalog.sync` never touches those fields |
| [`SupplierItemMappings`](../../app/models/supplier-item-mappings.ts) | The tax mapping: `(storeId, supplierCnpj, supplierItemCode)` → `rawIngredientId` + `conversionFactor`                                             |
| [`Orders`](../../app/models/orders.ts)                               | One sale: `totalValue`, `calculatedCost` (that sale's real CMV) and `profitMargin`, stored at sale time — never recalculated afterwards           |
| [`ProcessedInvoices`](../../app/models/processed-invoices.ts)        | An idempotency guard per NFe (access key) — today only the header, see [Open / pending decisions](#open--pending-decisions)                       |

## Half 1 — a purchase credits stock (`sefaz.nfe.received`)

For each line (`det/prod`) of the NFe's full XML (see [sefaz-nfe.md](./sefaz-nfe.md)):

1. Look up `SupplierItemMappings` by `(storeId, supplierCnpj = emit/CNPJ without formatting,
supplierItemCode = cProd)`.
2. **No match** → the line stays pending manual mapping (see
   [Open / pending decisions](#open--pending-decisions) — we have not yet decided where this
   pending item becomes visible for the owner to complete later). Outside the MVP: no automatic
   AI suggestion — that was an explicit decision not to do now.
3. **With a match**, convert the line to the ingredient's balance and roll the weighted average
   cost:

   ```
   convertedQuantity = qCom (the NFe's commercial quantity) × conversionFactor
   held              = max(0, currentStock)
   newAverageCost    = (held × averageCost + landedValue) / (held + convertedQuantity)
   newCurrentStock   = currentStock + convertedQuantity
   ```

   Two refinements over the first design (2026-09-26):

   - **`landedValue`, not `vProd`.** A line's cost is what it really cost: its own freight,
     insurance and other expenses, minus its own discount, plus its share of whatever the invoice
     total (`vNF`) adds on top of the items — note-level freight, other expenses, IPI/ST, discounts —
     spread in proportion to each line's value. In a real 24-invoice batch the items summed to
     R$ 12.490,05 and the invoices to R$ 12.583,15; the R$ 93,10 difference (freight 58,30 + other
     59,80 − discount 25,00) was being left out of every cost. Now Σ landed = Σ `vNF` exactly. A gap
     bigger than 50% of the items is not spread (it is not freight, it is something not understood).
   - **Only stock on hand carries cost into the average.** A negative balance (sold before it was
     bought) counts as 0 in `held`, otherwise it would drag the average of the next purchase; the
     balance itself still moves by the full quantity. The result is rounded to 8 decimals.

   Every applied line is also written to the `stock_movements` ledger — see
   [Stock](./stock.md#the-ledger-stock_movements).

   Using `vProd` (the line's total value) directly, instead of computing an intermediate unit
   cost, avoids rounding twice.

## Half 2 — a sale debits stock and fixes the CMV (`pos.order.received`)

1. **Idempotency**: the unique index `(storeId, externalOrderId)` on `Orders` is the lock — the
   job must not debit stock twice for the same order (a `getorders` reconciliation hitting an
   already-processed order has to be a no-op).
2. Resolve each item sold in `PartnerProducts` by `(storeId, externalId)`.
3. **Aggregate the recipe to debit**: `product.recipe` (multiplied by the item's quantity sold)
   **+** the `modifier.recipe` of each add-on selected in the order (see
   [Open / pending decisions](#open--pending-decisions) on the payload format).
4. For each aggregated `rawIngredientId`, debit **atomically** (`findOneAndUpdate` with a negative
   `$inc` on `currentStock`, never read-modify-write) and read `averageCost` **from the same
   document returned by the atomic operation** — it avoids a second query and a race with a
   purchase rolling the cost in the middle.
5. `calculatedCost = Σ (quantity debited of the ingredient × averageCost read in step 4)`.
6. `profitMargin = (totalValue - calculatedCost) / totalValue`.
7. Write the `Order`. If `newCurrentStock < minAlertStock` (and `minAlertStock > 0`), enqueue the
   low-stock alert — the design of the trigger itself is left to the WhatsApp doc (step 4).

## Half 2 — implemented (2026-10-02): `pos.order.received`

What exists, in `app/lib/services/order-stock.ts` (job `app/jobs/pos-order-received.ts`, rule in
`app/lib/order-consumption.ts`):

- The Alloy webhook stores each delivery in `pos_events` and enqueues one `pos.order.received` job per
  event (see [alloy-api.md](./alloy-api.md)). The job upserts the `Orders` row by `(storeId, ref)` — items
  with their complements, channel, `placedAt` (the PDV's naive local time read as UTC-3), delivery fee,
  discount and the items' revenue as `totalValue`.
- **When it debits**: any event whose status is **2 or more** (accepted, in transit, delivered). iFood orders
  arrive already accepted. A cancellation event gives the stock back; an order cancelled before its debit is
  marked `reversed` so a late status event cannot debit it.
- **How much**: for each line, `quantity × product recipe` plus, for each complement, `line quantity ×
complement quantity × complement recipe`, summed over every entry (the same code can repeat inside a combo).
  Recipes are looked up by PDV code (`product_recipes`); a product with no code is matched by name against
  the catalog row's own recipe. A complement with no recipe is "not answered"; one saved empty "consumes
  nothing".
- **Cost of the sale**: each ingredient debit is a `sale` movement valued at the average cost _of that
  moment_; `Orders.calculatedCost` is their sum and `profitMargin = (totalValue − cost) / totalValue`.
- **Idempotent**: unique `(storeId, source.externalOrderId, rawIngredientId)` on `sale` (and on `reversal`)
  movements; the movement is written before the stock moves and taken back if the move fails. Verified on a
  real MongoDB with two concurrent runs of the same order: the stock moved once.
- **Honest about gaps**: products and complements without a recipe are not guessed; they are listed in
  `Orders.incompleteLines`, so the cost of that order is a floor.

**Reprocessing and the Pedidos screen (2026-10-02).** The ledger works by **revision**: an order's rows carry
`source.orderRevision`, and the unique index is per `(store, order, ingredient, revision)` and type. Settling an
order is one operation, `settleOrderStock`: it reads what the ledger already shows (sales − reversals), compares
it with what the recipes say now (the _target_) and writes **only the difference** — more is a `sale`, less is a
`reversal` at the cost it was taken at. The first debit, a reprocess after a recipe was added, and a cancellation
(empty target) are all that one operation. Reprocess and cancel first claim the next revision with a conditional
update on `Orders.stockRevision`, so two runs cannot settle the same order at once (verified on a real MongoDB:
two concurrent bulk reprocesses → one wins; shrinking a recipe gives the surplus back; a cancellation nets the
ledger to zero).

`/organization/orders` ("Pedidos"): summary (orders, share debited with a complete recipe, incomplete orders, sales
without a recipe in R$), a "Recipes to register" ranking by the money of the orders each missing recipe sits on
(links to Produtos / Complementos), and the list with filter (incomplete / debited / pending / reversed), search by
reference or item, the cost shown as a floor (`≥`) while recipes are missing, a per-order "Reprocessar" and a bulk
"Reprocessar incompletos" (job `pos.orders.reprocess`). `scripts/dev/seed-orders.ts` fills it with sample rows.

Not built yet (each is its own step): a screen of the stock movements of an order (the ledger is there); matching a complement with no PDV code when its name is ambiguous (only its name exists); the unit of the soda "free of charge" complement; reconciliation against counts.

## Decisions already made

- **Stock may go negative.** It does not stop at zero. A negative balance is a sign that the owner
  forgot to record a purchase or the recipe is wrong — it becomes a discrepancy datum to show on
  the dashboard, not an error that blocks the sale.
- **A sale with no recipe** (empty recipe or `PartnerProduct` not found): writes the sale normally
  with `calculatedCost = 0` and `profitMargin = 1`, without alerting on the spot — it is an
  expected onboarding gap. It is left to the dashboard to flag "N products with no recipe" later.
- **No AI in the mapping for the MVP.** An NFe line with no match in `SupplierItemMappings` stays
  pending manual mapping — no automatic suggestion for now (avoids over-engineering before
  validating the manual flow).

## Open / pending decisions

- **Where does a line with no mapping become visible for the owner to map later?**
  `ProcessedInvoices` today only holds the invoice header (key, value, status) — not the items.
  Without persisting the line that did not match somewhere (supplier, `cProd`, description,
  value), the pending manual mapping has nowhere to "show up" for the owner to review. It needs a
  modeling decision (a new collection? a field on `ProcessedInvoices`?) before actually
  implementing `sefaz.nfe.received`.
- **The exact format of Alloy's order payload** is still unconfirmed (see
  [alloy-api.md](./alloy-api.md)) — step 3 of the sale flow above assumes the payload carries the
  items sold with their selected modifiers and the quantity of each; that needs validating against
  a real payload (including whether a modifier can be sold in a quantity > 1, like "2x bacon")
  before coding `pos.order.received`.
- **First sale of an ingredient never purchased**: `averageCost` starts at `0` by default — the
  first sale that uses that ingredient comes out with an artificially perfect CMV until the first
  NFe of that ingredient is processed. It is not a bug, but it deserves a warning in the
  UI/dashboard.
- **The exact idempotency strategy in the job code**: the unique index prevents duplicating the
  `Order`, but the order of operations (try to insert the `Order` first and only debit stock if it
  does not collide, vs. debit and then insert with a manual rollback on collision) has not been
  decided yet — it matters so that stock is not debited on an attempt that later fails to write
  the `Order`.

## Idea: a supplier that only invoices at month's end (not implemented)

Found 2026-09-27, from a real invoice: a bread supplier delivers **weekly**, but only issues one
NF-e at the **end of the month** for the whole month's total. Half 1 credits stock exactly when the
NFe posts — so for most of the month, `sefaz.nfe.received` sees nothing for that ingredient while
`pos.order.received` keeps debiting it on every sale. `currentStock` runs down and goes negative
(already an accepted state — see "Decisions already made" above), which is fine as a data point but
**wrong as an alert**: the low-stock WhatsApp notification (step 7 of Half 2) would fire for an
ingredient the owner knows is sitting in the kitchen, undermining exactly the trust the WhatsApp
channel is meant to build (see [WhatsApp — quick query and alerts](./whatsapp-quick-query.md)).

Cheapest fix, no code: the owner tunes `minAlertStock` down (or off) for an ingredient they know
restocks in one lump sum on a known cadence — `currentStock`/`minAlertStock` are already freely
editable (see [Stock](./stock.md#behavior)). Worth trying before building anything below.

If that is not enough — the owner also wants to _see_ an accurate number mid-month, not just avoid
a false alarm — a three-part plan, each phase reviewed before the next:

1. **A lightweight manual top-up, text first.** The owner sends a fixed-format WhatsApp message
   ("chegou pão, 20 pacotes") that credits `currentStock` right away, at the last known
   `averageCost` (an estimate). Reuses Option A (fixed-command, no AI) already on the table in
   [WhatsApp — quick query and alerts](./whatsapp-quick-query.md#option-a--fixed-command-bot-no-ai)
   — the ingredient-name fuzzy-match it needs is the same open problem noted there. **Photo of the
   delivery slip or audio come later, if text isn't enough**: unlike the DANFE's 44-digit key (see
   [SEFAZ NFe](./sefaz-nfe.md)), a small delivery slip has no standard machine-readable field, so
   reading it — or transcribing audio — means free-language understanding through the AI layer that
   is currently archived (see [Upcoming Implementations](../upcomingImplementations.md)), not a
   deterministic parse. Meaningfully more to build than the text path.
2. **Reconciling with the real NFe when it lands, without double-counting.** The month-end NFe
   cannot simply add its full quantity on top of what manual top-ups already credited. Two options:
   - **Net the difference**: sum the manual top-ups logged since that supplier's last invoice, and
     apply only the delta (plus recompute `averageCost` from the real value) when the NFe posts.
     Keeps the `stock_movements` ledger (see [Stock](./stock.md#the-ledger-stock_movements))
     truthful about when stock actually changed — better for reading real CMV history — but is
     more bookkeeping to get right.
   - **Supersede**: mark the period's manual entries as provisional and replace them outright with
     the NFe's numbers. Simpler, but loses the mid-month movement detail.
3. **Flagging a supplier that has gone quiet.** Track, per supplier CNPJ, the date of its last
   processed invoice (derivable from `ProcessedInvoices` — no new model needed just for this) against
   an expected cadence the owner sets when marking that supplier as "invoices late" (e.g. "roughly
   every 30 days"). Overdue → a factual WhatsApp notice ("Fornecedor X sem nota fiscal desde
   {date}; o normal é a cada {N} dias — vale falar com sua contadora"), **not a claim about a
   specific legal consequence** — we are not lawyers, and the real exposure (e.g. no IBS/CBS credit
   on an unsubstantiated purchase) varies
   by case.

None of this is code yet — it needs its own review, one item at a time, before implementing.

## Relevance to the Custeio jobs

| Job (`app/jobs/`)    | Role                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sefaz.nfe.received` | Half 1 — credits `RawIngredients` and rolls `averageCost` from the NFe's XML                                                    |
| `pos.order.received` | Half 2 — debits `RawIngredients` through `PartnerProducts.recipe`/`modifiers` and writes `Orders.calculatedCost`/`profitMargin` |
