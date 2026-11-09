# Architecture

[**architecture.html**](./architecture.html) — five pages, A4 landscape (`npm run docs:pdf` renders it to PDF):

1. **Topology** — the three roles of the same image (web, webhook ingestion, worker) and what talks
   to them.
2. **What lives where** — what Redis holds, what Mongo holds, and what happens if Redis goes down.
3. **The jobs** — the two that exist and the four that are the product (`pos.catalog.sync`,
   `pos.order.received`, `sefaz.nfe.received`, `whatsapp.message.incoming`).
4. **Data flow** — a purchase credits stock and rolls the average cost; a sale debits by recipe and
   fixes the real CMV.
5. **Multi-tenancy, secrets and limits** — Cliente → Loja → domain, where each credential lives and
   which external limits shape the design.

The PDF is not committed; generate it from the HTML with:

```bash
npm run docs:pdf
```

It renders with the Chromium that Playwright already installs for the e2e suite —
[`scripts/dev/render-docs-pdf.mjs`](../../scripts/dev/render-docs-pdf.mjs). To add a document,
append it to `DOCS` in that file.

## The short version

**Redis is coordination, not storage.** Three things live in it, none of them a source of truth:

1. the Bull queue `custeio-jobs` — the payload is `{ jobId }`, the job document is in Mongo;
2. the rate-limit counters, `rate:<scope>` per IP;
3. liveness — the health probe's `PING`, the worker heartbeat and the queue-depth sampling.

Sessions are not in Redis either: NextAuth uses the JWT strategy, so the session _is_ the
`authjs.session-token` cookie. Losing Redis costs throughput and in-flight enqueues; rate limiting
**fails open**.

**One image, three roles.** `web` (UI + admin API), `ingestion-api` (webhooks, no UI) and `worker`
(Bull consumer) are the same image with different `APP_LOAD_*` flags. The ingestion role **does not
serve any route yet**, and the router only classifies `/api/v1/*` (a prefix kept from the boilerplate)
as ingestion — the Alloy and Meta webhooks will need a prefix classified as such.

**Design versus code.** This paragraph was rewritten on 2026-09-29; the full map is
[`current-state.md`](./current-state.md). What exists: the topology, Mongo with the domain models
(`Orders`, `RawIngredients`, `PartnerProducts`, `SupplierItemMappings`, `ProcessedInvoices`,
`StockMovements`, `SefazRequests`), rate limiting, encryption at rest for the store token, the queue,
the two CSV export jobs, **`pos.catalog.sync`** (Alloy client) and **`sefaz.nfe.received`** (upload
of XML/PDF; the SEFAZ source is simulated). What does **not** exist: `pos.order.received`,
`whatsapp.message.incoming`, any webhook route, a live SEFAZ source.

See also: [Jobs](../features/jobs.md) · [Stock and real CMV](../features/stock-and-cmv.md) ·
[SEFAZ NFe](../features/sefaz-nfe.md) · [Alloy API](../features/alloy-api.md) ·
[WhatsApp](../features/whatsapp-quick-query.md)
