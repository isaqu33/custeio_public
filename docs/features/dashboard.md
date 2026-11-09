# Dashboard

## Scope

The tenant's landing page, **with real data since 2026-10-10**: the four numbers the product leads
with, then **"Precisa da sua atenção"**, the exceptions that call for a decision (exception driven: a
kind with nothing to report is absent, and an empty list means all is well; money first where it can be
said).

| Tile         | Shows                                                    | Read from                                           |
| ------------ | -------------------------------------------------------- | --------------------------------------------------- |
| `stockValue` | Value of the stock on hand (an **estimate**: purchases minus sales, reliable only after a physical count) | `getStockSummaryForStore` |
| `cmv`        | Cost of goods sold, last 30 days                         | sales history: complete-recipe orders only          |
| `margin`     | Margin, last 30 days                                     | same                                                |
| `lowStock`   | Ingredients at or below their minimum                    | `RawIngredients.minAlertStock`                      |

CMV and margin only count orders whose recipes were all found, and say how many that is ("25 de 28
pedidos"): an incomplete order has a partial cost and would make the numbers look better than they are.

Attention items (`app/lib/attention.ts`, fed by `services/dashboard.ts`), in the order that breaks the
numbers most: products sold **without a recipe** (with the revenue of the orders they sit in), **negative
stock**, **preparations with no batch registered**, **ingredients in recipes with no cost**, **prices that
rose** (what the latest purchases cost above the old price), **below minimum stock**, and **ingredients
created from invoices never reviewed**. Each links to the page that fixes it.

## Routes

- UI route: `/organization/dashboard`
- No API route, no backend feature: a server page that reads through `services/dashboard.ts`, scoped to a store the session may see (`StoreScopeSelector`).
- Landing: `LANDING_ORDER` in [`app/lib/landing.ts`](../../app/lib/landing.ts) is just this page, so
  it is where every login ends up.

## Behavior

- Server component; redirects to `/login` without a session.
- Copy comes from `copy.dashboard.tiles` (pt-BR default, en-US alternate).

## Restrictions

- Open to any authenticated session — **no feature gates it**, since it shows no data.
  `NAV_REQUIRED_FEATURE` is empty for the same reason. When the real dashboard reads something
  worth protecting, register a feature there and in `LANDING_ORDER`, and scope every query by the
  validated `organizationId`/`storeId` (see the multi-tenancy rule in `CLAUDE.md`).

## Testing

- `__tests__/server/page-guards.spec.ts` fails if the page loses its guard.
- `__tests__/client/app-sidebar-order.spec.ts` covers its place in the sidebar.
