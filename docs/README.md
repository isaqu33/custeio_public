# Custeio docs

| Folder                             | What it holds                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`features/`](./features/)         | Product behavior, page by page, plus the cross-cutting specs (Alloy POS, NFe capture through SEFAZ, stock/CMV, WhatsApp, billing).                                                  |
| [`design/`](./design/)             | UI patterns every page is expected to follow. Today: [data tables](./design/data-tables.md).                                                                                        |
| [`architecture/`](./architecture/) | Topology, what lives in Redis and in Mongo, the jobs (existing and planned), the stock/CMV data flow, tenancy and secrets. `architecture.html` is the visual version.               |
| [`operations/`](./operations/)     | Running in production: backup and restore, how to tell the queue is stuck, and the checklist before the first paying customer.                                                      |
| [`product/`](./product/)           | Vision, principles and roadmap (Custeio as an intelligence layer over the POS).                                                                                                     |
| [`domain/`](./domain/)             | The intelligence the product is heading to — stock coverage, purchase forecast, CMV reconciliation, supplier lead time. **All planned**; each file says what is and is not in code. |

Start here:

- [Product vision](./product/vision.md) — what Custeio is, and [roadmap](./product/roadmap.md) — IMPLEMENTADO / EM DESENVOLVIMENTO / PLANEJADO.
- [Current state](./architecture/current-state.md) — code vs. vision, doc divergences, model gaps.
- [Feature specs index](./features/README.md) — the per-page specs and the new-feature checklist.
- [Architecture](./architecture/) — the design, with what exists and what is still only design.
- [Backup and restore](./operations/backup.md) · [Alerting](./operations/alerting.md) ·
  [Go-live checklist](./operations/go-live-checklist.md)

Outside those folders: [`upcomingImplementations.md`](./upcomingImplementations.md) records the AI
differentiators designed for after the MVP.

## Known gaps

- **`e2e/`** — the Playwright specs still assume English labels (the app opens in pt-BR).
- There is no Postman/OpenAPI collection yet; the routes are listed in
  [`app/lib/features.ts`](../app/lib/features.ts).
