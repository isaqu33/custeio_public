# SEFAZ API — DF-e Distribution (purchase NFe)

Technical mapping of the national DF-e Distribution webservice, used to capture the **purchase
invoices** (the ingredient arrives, the supplier issues the NFe against the client's CNPJ) that
feed `RawIngredients` and the weighted average cost. Reference for implementing the
`sefaz.nfe.received` job described in [`CLAUDE.md`](../../CLAUDE.md).

> Researched on 2026-09-18 from public documentation (Technical Note 2014.002, Contributor
> Integration Manual 4.01, and open-source reference libraries such as `sped-nfe`/nfephp and
> `node-mde`). **Not yet tested against a real certificate** — unlike [Alloy](./alloy-api.md),
> where we already validated the connection against the production account, here we do not yet
> have a client e-CNPJ in hand. Treat endpoint URLs and host names as "probable, confirm before
> coding" (see [Open](#open--not-confirmed)).
>
> **2026-09-23 — Tier 1 + Tier 2 shipped, live polling still not.** `sefaz.nfe.received` exists
> (`app/jobs/sefaz-nfe-received.ts`), but it is fed by **manual upload** (the "Capturar
> insumos" button on the Estoque page — `components/capture-nfe-dialog.tsx`), not by
> `NFeDistribuicaoDFe` polling. Everything below this note about the live webservice — mTLS,
> certificate custody, the NSU cursor, rate limits — is still unbuilt; nothing in this repo calls
> SEFAZ over the network yet. What runs today, in `app/lib/services/nfe-capture.ts`:
>
> - **Idempotency** — `ProcessedInvoices.accessKey`, exactly as designed below.
> - **Tier 1** — an NFe line with no `SupplierItemMappings` entry drafts a new `RawIngredients` doc
>   (`isDraft: true`) instead of blocking: name from a Title-Cased `xProd`, unit/conversion factor
>   derived from `qTrib`/`qCom` scaled through a small KG/L → g/ml table (anything else tracked as
>   `un`). Editing and saving the draft by hand clears the flag — see
>   `updateRawIngredient` in `app/lib/services/raw-ingredients.ts`.
> - **Tier 2** — before drafting, the candidate name is compared (normalized, substring-contains)
>   against the store's existing ingredients; a match reuses that ingredient instead of creating a
>   duplicate. String containment only, no embedding/LLM step.
> - **Tier 3/4 (GTIN enrichment, LLM fallback)** — still just the plan below, not implemented; Tier
>   4 was explicitly excluded from this pass.
>
> **2026-09-28 — manual upload also reads a DANFE PDF, not only the XML** (`app/lib/nfe-pdf.ts`),
> for the common case of a shopkeeper who only has the printed/emailed PDF, not the structured file
> — see [DANFE PDF capture](#danfe-pdf-capture-not-only-xml) below.
>
> See [Stock (Estoque)](./stock.md) for the page/job-detail UI this feeds.

## DANFE PDF capture (not only XML)

Added 2026-09-28: a shopkeeper often only has the DANFE PDF the supplier emailed — not the
`.xml` the manual-upload dialog originally asked for — so `CaptureNfeDialog` now accepts either,
and `captureOneFile` (`app/lib/services/nfe-capture.ts`) dispatches on the file's actual bytes (a
`%PDF-` header, checked after decoding — not just the extension) to `parseNfePdf`
(`app/lib/nfe-pdf.ts`) instead of `parseNfeXml`. From there both paths converge on the same
`ParsedNfe` shape and the same Tier 1/2 capture pipeline described above — a PDF-sourced invoice
is indistinguishable from an XML-sourced one once parsed.

A DANFE has no schema — it's the _printed_ representation, and its item-table layout is
per-issuer, unlike the XML's fixed `procNFe` structure. So the two are trusted differently:

- **Always reliable, because the DANFE's layout is nationally standardized regardless of which
  software issued it** (Manual de Orientação do Contribuinte): the 44-digit access key (read as
  plain text and check-digit-validated, the same mod-11 check the key itself carries, so a misread
  is caught rather than silently wrong — see `accessKeyChecksOut` in `nfe-pdf.ts`), and the
  mandatory "RECEBEMOS DE `<fornecedor>` OS PRODUTOS..." receipt sentence, which also carries the
  issue date and invoice total. An invoice is captured (idempotency + landed-cost totals) from
  these four fields alone even when nothing below applies.
- **Best-effort, because the item table's column layout is per-ERP**: each candidate line is
  self-validated (quantity × unit price ≈ line total, within a cent) before being drafted — a line
  that doesn't check out is dropped, not drafted with a guessed quantity, same rule
  `packSizeFromDescription` (`app/lib/ingredient-naming.ts`) already follows for XML. A PDF whose
  item table cannot be found or self-validated still captures the invoice with `items: []` — the
  owner sees "0 items drafted", not an error, and nothing is credited to stock.
- The freight/discount landed-cost allocation (`allocateLandedValues`, shared with the XML parser
  via `app/lib/nfe-landed-cost.ts`) applies the same way to whatever items the PDF path did
  recover.

**Validated so far against exactly one real invoice** (a single-item Pão Ayres DANFE, 2026-09-27
— every field, including the one item's quantity/price/total, matched exactly) — expect the
item-table regex to need widening as more suppliers'/ERPs' PDFs are tried. The header-field
reading (access key, receipt sentence) is expected to generalize better, since that part of the
layout is the one SEFAZ actually standardizes.

## Pausing and resuming a sync (quota-aware)

Added 2026-10-02. "Buscar na SEFAZ" (`syncNfeFromSefaz`) pulls at most `MAX_BATCHES_PER_RUN` (3)
batches of 50, so a large backlog needs several runs. Instead of waiting for the owner to press
the button again, a run that stops with documents still waiting schedules its own continuation:

- **Gate before every batch.** The job re-checks SEFAZ's block and the hourly quota
  (`evaluateStoreGate(..., { ignoreCooldown: true })`) before each call. If it closed, the run
  ends as `paused` — a clean end, not a failure, so Bull never retries it.
- **Resume marker on the Store.** A run that paused, or that spent its batches on a full last
  one, sets `Store.sefazResumeAt` (when the cooldown/quota/block lets the next run start),
  `sefazBacklog: true` and `sefazBacklogMaxNsu`. The NSU cursor (`sefazUltNsu`) was already saved
  per batch. A run that reaches the end of SEFAZ's sequence clears the backlog.
- **The `sefaz.auto-sync` cron.** `resumePendingSefazSyncs` runs from the worker's scheduler (see
  [Crons](#crons-system--crons)). For each store whose `sefazResumeAt` has passed it goes through
  the same `claimSefazSync` as the button (atomic, so several worker replicas cannot double-run),
  enqueues a `mode: 'sefaz'` job with one attempt, and clears the marker only after the enqueue. A
  store the claim still refuses is pushed to when it opens.
- **Polling a store with nothing waiting** (2026-10-02, off by default). With
  `Store.sefazPollEnabled`, a run that ends with nothing left sets `sefazResumeAt` to now +
  `sefazPollIntervalMinutes` (15 min–24 h, default 60), never before the gate reopens, so the same
  cron checks the store again by itself. Turning polling off drops a scheduled poll but leaves a
  backlog resuming. A run that **fails** records why on the store (`sefazLastError`, shown in
  Crons) and, for a store with polling on, is tried again at the normal pace — one query per
  interval, a small slice of the 20/h quota.
- **A crashed run is not auto-resumed without polling.** The cron clears the marker when it claims
  a store, and only a run that ends cleanly sets it again. A failure that persists (a revoked
  certificate) therefore needs a person, instead of burning the 20/h quota every hour; a store
  with polling on is the deliberate exception, bounded by its interval.
- **Quota is booked before the call** (`reserveSefazRequest` → `settleSefazRequest`). A row
  with `cStat: 'pending'` or `'error'` counts toward the hour: a worker killed mid-call, or a
  timeout SEFAZ may have seen, no longer leaves the usage log under-counting.
- **Job result.** `files` is capped at `MAX_RESULT_FILES` (failures first, `filesOmitted` says
  how many were left out) so it cannot grow toward Mongo's 16 MB document limit; the counters
  still describe the whole run.

## Cancellation events

Added 2026-10-02. `NFeDistribuicaoDFe` also delivers events; a cancellation (`tpEvento 110111`,
as `resEvento` or `procEventoNFe`; a `procEventoNFe` must carry `cStat` 135/155 — a rejected event
cancels nothing) is parsed by `parseNfeEvent` (`app/lib/nfe-event.ts`) and applied by
`applyInvoiceCancellation` (`app/lib/services/nfe-cancellation.ts`). Any other event is only counted.

- **Captured invoice → stock given back.** Each purchase line gets a `reversal` movement (same
  `source`, opposite signs; one per line via a unique index, so a repeated or half-applied event
  refunds once) and its quantity is taken out of `currentStock`, which may go negative if the
  stock was already used. The invoice becomes `cancelled`. The job log says how much it was in
  money ("R$ 1.234,50 estornados em 3 linha(s)") and the run counts `invoicesCancelled`.
- **Average cost.** The average is a running weighted one, so the line's value is removed from the
  pool of stock on hand: `(held × cost − lineValue) / (held − quantity)` (`debitRawIngredientPurchase`).
  Exact when the line was the latest operation, a close answer after later purchases — the ledger
  cannot replay counts and manual cost edits, so it is **not** recomputed from scratch. With
  nothing on hand it falls back to the latest surviving purchase's cost, or stays as it was.
  `lastPurchase` is re-pointed at the latest purchase no reversal has undone.
- **Event before the invoice.** If the invoice was not captured yet, the cancellation is kept
  (`InvoiceCancellations`); capturing it later (SEFAZ or manual upload) records it as `cancelled`
  and credits nothing.
- A database failure while applying one is **not** swallowed: the batch cursor stays put and the
  next run applies it.

## Crons (System > Crons)

Added 2026-10-02. The worker has one scheduler (`scripts/worker.ts`) ticking every minute;
`runDueCrons` (`app/lib/services/crons.ts`) runs each task in `app/lib/crons/definitions.ts` that is
on and whose interval has passed. State lives in `cron_settings` (`CronSettings`), so pausing a
task or changing its interval needs no restart; each run is claimed with an atomic update so
several worker replicas never run it twice; a task that throws is recorded on its row and waits a
full interval. Tasks: `sefaz.auto-sync` (above) and `queue.cleanup` (old failed Bull jobs).

`/system/crons` (System/Support only) lists the tasks (state, interval, last/next run, last
result or error) and every store's automatic search, with pause/resume and interval editing. Routes:
`crons.get_all` → `/api/crons`, `crons.update` → `/api/crons/update`, `crons.update_store_polling` →
`/api/crons/stores/update` (audited per organization). `SEFAZ_RESUME_INTERVAL_MINUTES`,
`APP_BULL_CLEANUP_INTERVAL_HOURS` and `APP_BULL_FAILED_JOB_TTL_DAYS` now only seed the first values.

Still not covered: nothing in Crons can poll for real until `SEFAZ_SOURCE=live` exists (certificate
custody, decided to be Azure but not built); the simulated source is what polls today.

## Decision: SEFAZ direct, not an aggregator

We considered using an aggregator (FocusNF/Arquivei, cited in `CLAUDE.md`) to avoid dealing with
digital certificates. Decision: **go straight to SEFAZ**. Reasoning:

- Custeio's audience (a hamburger-joint/snack-bar owner with a CNPJ) already lives with tax
  bureaucracy — asking for their own certificate is not an unusual obstacle for this segment,
  unlike a fully informal audience.
- It avoids depending on (and paying) an intermediary for the product's most critical feature.
- We checked that **Alloy is not a shortcut to the certificate**: none of the 5 APIs documented
  in [alloy-api.md](./alloy-api.md) exposes a tax credential, and even if one did, handing over a
  client's private key through a partner API is a legal responsibility no serious platform takes
  on. The e-CNPJ has to come directly from the shopkeeper during Custeio onboarding.

## How to get access

There is no "developer token" as with Alloy — access is public, but **per CNPJ**, through a
digital certificate. What the client has to provide during onboarding:

- **An e-CNPJ certificate, model A1** (a `.pfx` file + password), **not A3** (a physical
  token/smartcard). A3 requires the hardware plugged into a machine — unworkable for a worker
  running in the cloud unless we also contract a separate "cloud certificate" service. This has
  to be said explicitly on the onboarding screen, or we will receive A3 and stall the rollout.
- **Annual** renewal (A1 expires after 1 year) — needs an alert/reminder, otherwise the
  integration silently stops working when the certificate expires.
- The certificate already enables the query automatically — no additional registration is needed
  in the SEFAZ panel, unlike Alloy, which requires manual release of a developer area.

**A point to validate at onboarding**: SEFAZ's documentation is explicit that **there cannot be
more than one software querying the same CNPJ's invoices** (distribution uses a single cursor per
CNPJ — two consumers fight over the same NSU). If the client already uses an ERP/accounting system
that also downloads purchase XMLs, this has to be asked before activating — the two will collide.

## Authentication

- **mTLS** with the client's e-CNPJ A1 certificate (presented on the TLS connection, not in a
  header).
- The SOAP message of the manifestation event is **signed** with that same certificate — the base
  CNPJ (the first 8 digits) of the signature has to match the NFe's recipient CNPJ.
- Protocol: **SOAP 1.2** — the `action` travels inside the `Content-Type` header
  (`application/soap+xml; ... action="..."`), not in a separate `SOAPAction` header (unlike SOAP
  1.1, which is the most common standard in old examples on the internet).
- `tpAmb`: `1` production / `2` homologation.
- `cUFAutor`: the IBGE code of the **querying author's** state (the state of the CNPJ doing the
  query, e.g. `35` for SP) — it is not a special "national environment" code.

## The 2 operations that matter

### 1. `NFeDistribuicaoDFe` — querying/downloading the documents

A single national service (Ambiente Nacional — it does not vary by the taxpayer's state, unlike
the issuance-authorization webservice). It accepts three query modes, mutually exclusive:

| Tag         | Use                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distNSU`   | Main mode: incremental distribution from a `ultNSU` cursor (starts at `0`; persist the last value received per Store — the CNPJ is the key, and the CNPJ lives on the `Store`, not on the `Organization`) |
| `consNSU`   | Queries one specific, already-known NSU                                                                                                                                                                   |
| `consChNFe` | Queries by the access key (44 digits) of a specific NFe                                                                                                                                                   |

**Response**: one `docZip` per document, compressed with gzip + base64. The inner schema says what
came back:

| Schema                    | Content                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `resNFe_v1.01.xsd`        | **Summary** of the NFe (issuer, value, key) — has no items                 |
| `procNFe_v4.00.xsd`       | The **full** NFe + authorization protocol — has the items/products we need |
| `resEvento_v1.00.xsd`     | Summary of an event (e.g. cancellation, correction letter)                 |
| `procEventoNFe_v1.00.xsd` | The full processed event                                                   |

**The detail that changes the job's design**: a new NFe arrives first as a `resNFe` (summary
only). To receive the full `procNFe` (with the items, which we need for the `SupplierItemMappings`
mapping), **the recipient's manifestation has to be registered first** — see the next section.
Without it, the job never sees the actual content of the purchase.

### 2. `NFeRecepcaoEvento` — the recipient's manifestation

An event that the **recipient** (Custeio's client) registers saying they are aware of the
operation. Event codes:

| Code     | Type                                      | Justification required? |
| -------- | ----------------------------------------- | ----------------------- |
| `210200` | Operation Confirmation                    | No                      |
| `210210` | Operation Awareness (Ciência da Operação) | No                      |
| `210220` | Operation Unknown                         | No                      |
| `210240` | Operation Not Performed                   | Yes (15–255 characters) |

For our use case (reading the items of a real purchase the owner already made), it is enough to
fire **Ciência da Operação (`210210`)** automatically as soon as a new `resNFe` shows up — that
already releases the full `procNFe` in the next query. Formally SEFAZ expects a conclusive
manifestation afterwards (`210200` or `210220`/`210240`), but that is a product decision for later
(e.g. asking the owner "is this purchase right?" over WhatsApp) — it does not block the job from
reading the items and updating stock/cost.

## Limits and status codes (`cStat`)

| `cStat` | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| `137`   | No new document found — just try again after the minimum interval |
| `138`   | Documents found (success)                                         |
| `656`   | Improper use — access **blocked for 1 hour**                      |

Rules measured/documented by reference implementations (not yet tested by us):

- **At most 50 documents per `distNSU` call** — if the batch comes back full, there are more NSUs
  to fetch; repeat with the new `ultNSU`.
- **20 queries per hour per CNPJ/certificate** (confirmed across multiple sources — Focus NFe,
  Qive/Arquivei, Tributos.io — researched 2026-09-22, see [Sources](#sources)) is the actual
  documented ceiling for `distNSU`/`consNSU`/`consChNFe`, tighter than this doc's original estimate.
  Going over it triggers `cStat 656` and a **1-hour block**; retrying before the hour is up **resets
  the block's clock** instead of counting down. Much looser than Alloy's 2 req/min, but the failure
  mode is worse: a `429` just slows you down, a `656` freezes that Store's sync entirely for an hour.
- **Multiple apps polling the same CNPJ must share one ascending NSU sequence** — if
  `sefaz.nfe.received` and, say, the client's own accounting software both poll the same Store's
  certificate, out-of-order queries get flagged as improper use too. Reinforces the "one software
  only" open question below.
- Since each `distNSU` call returns a batch (not one document per call) and the ceiling is
  20/hour, polling **every 15–30 min per Store** is comfortably inside the limit even for a busy
  store — no reason to space it out to hours. This implies that `sefaz.nfe.received`, despite the
  name, is essentially a **scheduled polling job** per Store, not something reactive to a real-time
  event — there is no "NFe received" webhook on the SEFAZ side.

### Historical backfill — how much of the past can we actually recover

Question that came up while designing the ingredient-capture plan below: when a new Store turns on
its certificate, can we pull "the whole month" of purchase NFes to seed `RawIngredients` right
away? **Partially, and only in the best case:**

- Documents stay queryable via distribution for **up to 90 days** after entering the Ambiente
  Nacional — so in principle a first sync could reach back ~3 months.
- **But** NSU generation for a CNPJ only keeps flowing if that CNPJ's distribution service has been
  queried **at least once in the last 60 days**. A Store's CNPJ that has _never_ used
  `NFeDistribuicaoDFe` before (the common case — a shopkeeper who never had software doing this)
  may have its NSU sequence interrupted/at zero, meaning the first `distNSU` call starts delivering
  **from the moment we start polling forward**, not automatically backfilling everything the
  supplier already issued before that point.
- **Practical consequence for onboarding**: turning on a Store's certificate late in the process
  risks silently losing purchases from before that point. Mitigations, none implemented yet:
  1. Activate the certificate/`distNSU` polling as early as possible in onboarding — even before
     the rest of the Store record is complete — specifically to start the NSU clock running.
  2. **A real way to still pull an old note automatically, found 2026-09-28: query by access key
     (`consChNFe`) instead of the `distNSU` cursor.** Since NT 2014.002 v1.15, returning an NSU is
     no longer mandatory for a `consChNFe` query — so it does **not** depend on the CNPJ's NSU
     cursor being "warm" ([TOTVS](https://www.totvs.com/blog/fiscal-clientes/torna-se-facultativo-o-retorno-de-nsu-nas-consultas-por-chave-de-acesso-no-uso-do-web-service-de-distribuicao-df-e/)).
     A CNPJ on its very first certificate can still recover a specific old note this way, as long
     as: (a) it was authorized within the last 90 days
     ([Tributos.io](https://tributos.io/blog/legislacao-e-normas/servico-nfedistribuicaodfe-consulta-df-e-por-nsu-e-chave-2024)),
     (b) we know its 44-digit access key, and (c) we still send the Ciência da Operação for that key
     first — the manifestation requirement is independent of NSU and still gates the full `procNFe`
     the same way it does for `distNSU` (confirmed: querying by key with no manifestation on file
     returns only the `resNFe` summary, same as the incremental cursor). **The bottleneck moves from
     "was the certificate active" to "do we have the access key"** — see the idea below for where
     the key can come from. The 20-queries/hour ceiling is shared across `distNSU`/`consNSU`/
     `consChNFe`, so backfilling many old notes this way still competes with the regular polling.
  3. For anything whose key we cannot get any other way, fall back to manual XML import (already
     supported — `sefaz.nfe.received` processes a single XML the same way regardless of how it
     arrived) instead of promising an automatic full-month backfill.

#### Idea: capture the access key from a photo of the paper DANFE, over WhatsApp (not implemented)

Discussed 2026-09-28, prompted by mitigation 2 above needing an access key from _somewhere_. Every
printed DANFE carries the 44-digit key (and, on newer ones, a QR code encoding it) even when the
owner never had the XML file to begin with — which is the common case for a small shopkeeper who
just keeps the paper. Since WhatsApp is already the planned channel (see
[WhatsApp — quick query and alerts](./whatsapp-quick-query.md)), the owner could photograph the
DANFE and send it there; `whatsapp.message.incoming` (or a dedicated onboarding flow) reads the QR
code or the printed digits, then runs mitigation 2 (Ciência + `consChNFe`) for that key.

- **Lower friction than Alloy's own manual import**, which asks the owner to locate and upload the
  actual `.xml` file — something they often do not have on hand, only the paper. A photo of what
  they are already holding is strictly less to ask.
- Scope: an **onboarding/backfill aid**, not a substitute for the ongoing automatic capture — it
  only matters for notes issued before the Store's certificate started polling.
- Open points: reading the QR code vs. OCR-ing the printed digits (the QR is more reliable when
  present); where this flow lives (part of `whatsapp.message.incoming`, or a separate onboarding
  job); and whether it is worth building before validating, with a real onboarding, how much paper a
  new client actually needs backfilled.
- **A cheaper first alternative for a client whose accountant already manifests their notes** (our
  actual first case — see the section above on the Ciência): the accountant's own bookkeeping
  software likely already holds the full XMLs for the backfill window, since manifesting is what
  unlocked them. Asking for that batch and running it through the existing manual import avoids
  touching SEFAZ a second time.

## Architecture implication

- **CNPJ and certificate are per `Store`, not per `Organization`** — since the Cliente/Loja split
  (see [Stores](./stores.md)), the CNPJ lives on `Stores`, and an `Organization` can have N
  stores, each with its own e-CNPJ and its own NSU cursor. Everything the previous section calls
  "per organization" (cursor, certificate, job scheduling) is in practice **per Store**.
- **The NSU cursor per Store** has to be persisted (no field for it exists today in any model) —
  a likely candidate: a new field on `Stores` or a dedicated tax-sync-state collection. No schema
  change has been made yet; this is just the note for when the job is implemented.
- **Custody of the A1 certificate** is the most sensitive point of the whole integration: a
  leaked certificate lets someone sign tax documents in the client's name, not just read data —
  more critical than any credential we hold today (e.g. Alloy's `apiKey` in `Stores`).
  **Direction discussed (not implemented yet)**: separate the `.pfx` and the password into
  different trust boundaries, and do not store the two together.
  - The `.pfx` file can go in Azurite/Blob Storage, reusing the `AzuriteBlobAdapter`
    (`app/lib/azure-blob-storage.ts`) that already exists — but today it is a generic blob storage
    (no application-layer encryption, only Azure Storage's own), used so far only for far less
    sensitive things (logo, chat attachments).
  - The **password** should not be just another Mongo field (nor write-only like Alloy's `apiKey`
    is today) — together with the `.pfx` in the same blast radius (a Mongo dump + Storage access),
    the two together are already enough to sign on the client's behalf. A natural candidate:
    **Azure Key Vault** (we are already in the Azure ecosystem through Azurite) — it has a native
    "Certificate" object type made exactly for a PFX+password pair, with the key protected by an
    HSM and access through Managed Identity. In production it would be the real Key Vault; locally
    it would need a stub, since Azurite does not emulate Key Vault.
  - **A concrete finding that reinforces this**: we inspected the real test `.pfx` (Loja Piloto
    Hamburguer LTDA, CNPJ 00.000.000/0001-00) and the PKCS#12 uses `MAC: sha1, Iteration 2000` —
    the old/weak default of the format (current practice recommends 100,000+ iterations). We
    cannot rely only on the file's own encryption as a defense if it leaks on its own.
  - **This is a direction, not a closed decision** — when we actually build the certificate upload
    screen, revisit the options (Key Vault vs. simpler envelope encryption with a master key in an
    environment variable, cheaper but weaker) before implementing.
- Unlike Alloy (where the credential config already has a UI — the "Configure POS integration"
  action on `Stores`), here there is still no place in the product for the client to send the
  certificate — it is the next piece of UI that will be missing when we implement this for real.
  Probably the same store-management screen, since it is a per-CNPJ/store credential like Alloy's
  `apiKey`.

## Relevance to the Custeio jobs

| Job (`app/jobs/`)    | SEFAZ webservice(s)                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sefaz.nfe.received` | `NFeDistribuicaoDFe` (scheduled polling, `distNSU`) **+** `NFeRecepcaoEvento` (automatic Ciência da Operação manifestation to release the full XML) |

## Plan: automating `RawIngredient`/`SupplierItemMappings` capture from purchase NFes

Discussed 2026-09-22. Today the only way to get a `RawIngredient` and its `SupplierItemMappings`
De/Para entry (`cnpj_fornecedor` + `cProd` → `rawIngredientId` + conversion factor) is manual entry
by the shopkeeper. Goal: once `sefaz.nfe.received` is polling a Store (see above), use the data
already inside every `procNFe` item to turn "cadastrar do zero" into "confirmar uma sugestão" — a
tiered plan, cheapest/highest-ROI first. **None of this is implemented — this is the agreed
direction for when the job is built**, and each tier can ship independently.

1. **Tier 1 — draft suggestion straight from the XML (no external dependency).** When
   `sefaz.nfe.received` sees an NFe item (`cProd`) with no matching `SupplierItemMappings` for that
   Store, auto-create a **draft** `RawIngredient` + mapping instead of blocking on manual input:
   - Name: cleaned-up `xProd` (the supplier's free-text description).
   - Unit + conversion factor: derived from `qTrib`/`qCom` (taxed quantity over commercial
     quantity) — the same trick ERPs like Bluesoft/Nex already use for "bought by the box, tracked
     by the unit" conversions (see [Sources](#sources)).
   - The owner reviews/confirms/edits the draft (product surface TBD — likely the same place other
     pending actions surface, or a WhatsApp confirmation) instead of filling a blank form.
2. **Tier 2 — dedupe against what the Store already has.** Before creating a new draft, compare the
   candidate name against the Store's existing `RawIngredients` (string similarity to start; an
   embedding/LLM comparison later if precision demands it) so the same ingredient bought from two
   different suppliers — each with its own `xProd` wording — doesn't become two records.
3. **Tier 3 — GTIN enrichment (optional, paid, partial coverage).** When the NFe item carries a
   `cEAN` (GTIN/barcode), look it up against a product database to replace the often-cryptic
   `xProd` with a clean canonical name:
   - **Cosmos (Bluesoft)** — ~18M SKUs, simple REST API with a token (`GET /gtins/{código}`),
     cheapest to integrate. Third-party aggregator, not the source of truth.
   - **GS1 Brasil / Cadastro Nacional de Produtos (CNP)** — official (the brand owner registers
     directly), but more onboarding friction and coverage skews toward supermarket-shelf goods over
     small/local food-service suppliers.
   - Caveat that limits how much this tier alone can do: small and informal suppliers common in
     this segment often don't register a GTIN at all, so Tier 1's `xProd`-based draft remains the
     fallback even after adding this.
4. **Tier 4 — LLM fallback for the messy remainder.** For items with no GTIN match and a poor Tier 2
   match, send the raw `xProd` through a cheap LLM call to normalize name/unit/category — the same
   kind of "automação inteligente" competitors (Saipos, Food Sistemas, VEX Menu) are already
   marketing as the 2026 trend in this space, i.e. not a solved problem in the market, room to
   differentiate.

Tier 1 alone removes most of the manual-entry friction with zero new external dependency, since it
only needs data the `procNFe` XML already carries. Tiers 3–4 are refinements for when `xProd`'s raw
wording proves too messy in practice.

### Tier 4 decision: Azure OpenAI, pay-as-you-go

Discussed 2026-09-22. The concern driving this choice: the client should never see a volatile,
unpredictable AI line item at the end of the month, and we want one fewer billing relationship to
worry about. Three options were compared before deciding:

| Option                              | Stays inside Azure?                | Cost                                                                              | Main risk                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure OpenAI (PAYG)** — chosen    | Yes                                | ~cents/month at this volume (GPT-4o-mini: $0.15/1M input, $0.60/1M output tokens) | None significant — this is the "no drama" path                                                                                                                                                                                |
| Self-host (Ollama + Phi-3.5/4-mini) | Yes (same infra)                   | Fixed, but needs 6–8 GB extra RAM on the host just for the model                  | Phi is English-first; Portuguese/food-service-abbreviation quality unverified                                                                                                                                                 |
| Gemini free tier                    | No — separate Google Cloud account | R$0                                                                               | Not resold through Azure at all (Google's own stack, a direct Azure competitor); free-tier inputs train Google's models by default; free tiers can change or disappear without notice (see the GitHub Models precedent below) |

Why Azure OpenAI won:

- **Actual cost is negligible for this use case.** Tier 4 only fires for the leftover items Tiers
  1–3 couldn't resolve — normalizing a short `xProd` string is a tiny prompt. At GPT-4o-mini
  pricing this rounds to cents per month even across several Stores, so the "volatile billing"
  worry doesn't really apply in practice; it's not a variable cost that can spike.
- **Self-hosting doesn't actually remove cost, it moves it** — running Ollama well needs 6–8 GB of
  RAM beyond what Web/Worker/Mongo/Redis already use, which likely means upsizing the production
  VM. That's a real fixed cost too, and on top of that Phi's Portuguese quality for this segment's
  abbreviated food-service jargon is unverified. Not ruled out for later, just not worth the
  infrastructure work for what Tier 4 actually costs today.
- **Gemini's free tier looked attractive on volume** (its Flash-Lite tier's ~15 RPM/~1,000–1,500
  RPD easily covers a fallback tier) **but fails the actual goal**: it is not available through
  Azure at all (Google doesn't resell Gemini via Microsoft Foundry — separate hyperscaler, separate
  bill), it trains on free-tier input by default, and free tiers can be pulled with no notice —
  GitHub Models, a comparable free offering, was retired in July 2026. That reintroduces
  unpredictability as an availability risk instead of a billing one, which is the opposite of what
  we're trying to buy here.
- Staying inside Azure also keeps this on the same trust boundary already used for the rest of the
  infra (Blob Storage, and the Key Vault direction discussed for the e-CNPJ certificate above) —
  one fewer vendor relationship, authenticated the same way (Microsoft Entra ID / Managed Identity
  preferred over a raw API key).

**Not yet implemented** — this is the agreed direction for whenever Tier 4 is actually built.
Two things to confirm at that point, not before: (1) that the chosen model is deployable in
**Brazil South**, since Azure AI Foundry doesn't guarantee full feature parity in every region yet;
(2) real-world quality of GPT-4o-mini (or whatever the cheapest suitable model is then) on a sample
of actual messy `xProd` strings, before trusting it to auto-suggest a `RawIngredient`.

## Investigated: can we avoid holding each client's certificate?

Yes, we investigated — and the answer is **no, we did not find a confirmed way**. The hypothesis
was to use **Electronic Power of Attorney** (Procuração Eletrônica, e-CAC/gov.br) so Custeio
could have a single certificate of its own and each client would just grant access, instead of us
holding everyone's `.pfx`.

- The e-CAC Electronic Power of Attorney **is real**, and in it the grantee authenticates with
  their **own** certificate — but it covers **e-CAC/Receita Federal** services (installment
  plans, filings such as DCTF, rectifications). It is federal revenue infrastructure.
- `NFeDistribuicaoDFe` is **not an e-CAC service** — it is a SOAP webservice of the state SEFAZs
  (Ambiente Nacional), with its own authentication: it validates the certificate presented in
  mTLS/signature against the base CNPJ of the document's legitimate parties (issuer, recipient,
  carrier, or someone in that NFe's `autXML` group). There is no sign that this webservice
  consults the e-CAC power-of-attorney base — they are different systems with no documented
  bridge.
- The only third-party authorization mechanism that **exists in the protocol** is `autXML` — filled
  in by the **supplier** when issuing the invoice, not by the recipient. Unworkable for us: it
  would depend on asking each of the client's suppliers to include Custeio's CNPJ on every
  invoice — with no control on our side.
- The real-world "an accountant accesses invoices of several clients with one certificate"
  pattern is probably because the accountant **keeps a copy of the client's own certificate**, not
  because of a cryptographic shortcut.

**Decision**: we keep custody of each client's A1 e-CNPJ as the design (the
[Architecture implication](#architecture-implication) section above) — there is no way around it
today.

## Open / not confirmed

- **Endpoint URLs** (researched 2026-09-24, from the `sped-nfe` reference config — the official
  Nota Técnica/WSDL was not reachable): production
  `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`, homologação
  `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` (SOAP method
  `nfeDistDFeInteresse`, version `1.01`; note `hom.` without the `1` fails with "no endpoint
  listening"). Implemented in `app/lib/sefaz-client.ts`; still worth confirming against the current
  WSDL.
- **Whether homologação serves `distNSU` at all** — sources contradict: `sped-nfe`'s docs say the
  service "only operates in production", yet its own config lists a `hom1` host and an ACBr forum
  thread shows it answering in homologação for a company that had issued NFe there (and timing
  out for another). Treat homologação as best-effort, not a guaranteed sandbox.
- **Behavior if the client already manifests invoices through another system** (accountant, ERP) —
  the "one software only" rule may cause a conflict; we do not yet know the practical effect
  (block? desynchronized cursor?).
- **Whether the `resNFe` (summary, no manifestation) is already enough** to identify supplier +
  total value and fire some preliminary notification before the full XML arrives — it may be worth
  it to reduce the latency the store owner perceives.
- None of this has been tested against a real certificate — the next practical step, when we
  implement, is to validate in **homologation** with a test certificate before any real client
  account (see the caveat on what homologation actually proves, below).

### Testing: localhost is fine, but homologação and produção are not interchangeable

Discussed 2026-09-22, in case it wasn't obvious from the "validate in homologation" bullet above.

- **Where the code runs doesn't matter.** `NFeDistribuicaoDFe` is a service _we_ pull from (there is
  no inbound webhook to receive), and SEFAZ documents its own guidance to resolve the host by DNS
  rather than a fixed IP — there is no whitelist to register. Authentication is entirely by the
  client certificate presented over mTLS, not by the caller's network origin. **A laptop running
  the job locally can talk to the real production webservice** just as well as a deployed server
  can; "produção" here is about which SEFAZ _environment_ (`tpAmb`) we point at, not where our own
  code is hosted.
- **But `tpAmb=2` (homologação) never has real invoices, even with real-looking data in the
  fields.** It is SEFAZ's own definition: documents issued in homologação have no fiscal/legal
  validity and can never represent an actual purchase — so pointing `sefaz.nfe.received` at
  homologação, even with the client's real certificate, will **not** surface the client's actual
  supplier invoices. It only proves the plumbing works (mTLS handshake, SOAP signing, XML parsing,
  the manifestation round-trip).
- **Seeing the client's real purchases requires `tpAmb=1` (produção)** — which can still be run from
  a local machine, but is no longer a harmless sandbox once it is: the automatic **Ciência da
  Operação** manifestation fired by the job has real legal effect on a real commercial document, and
  the **20-queries/hour limit** (see [Limits](#limits-and-status-codes-cstat)) is the real one — a
  buggy retry loop while debugging locally against production can burn the hour's quota or trip the
  `656` block on the client's actual CNPJ.
- **Recommended order**: try homologação first, then production — not because production is
  unreachable from a dev machine, but to avoid spending the real rate-limit budget while still
  ironing out bugs. **Correction (2026-09-24): there is no evidence of a "disposable test
  certificate" for this service** — every source found uses a real ICP-Brasil e-CNPJ A1, even in
  homologação. So the first test uses the A1 of a Store we control.
- **First production test is query-only**: one manual `distNSU` call
  (`scripts/dev/sefaz-dist-nsu.ts`, no loop, no retry), **no Ciência da Operação**. The
  manifestation is signed with the client's certificate, is a formal declaration in the Ambiente
  Nacional under their CNPJ and cannot be undone; the trade-off is that without it SEFAZ returns
  only `resNFe` summaries, not the `procNFe` items.

## Sending the Ciência da Operação ourselves (plan, not implemented)

Discussed 2026-09-25/26. The 49+ documents saved in `notas_testes` (mix of `resNFe` and `procNFe`)
were downloadable in full because the client's accountant had already registered the Ciência da
Operação (`210210`) in the Ambiente Nacional — confirmed with her. That does not scale: for every new
client, Custeio has to register the manifestation itself, otherwise `NFeDistribuicaoDFe` only ever
returns `resNFe` summaries (see [`NFeRecepcaoEvento`](#2-nferecepcaoevento--the-recipients-manifestation)).

Planned in three atomic items, each reviewed before the next:

1. **`buildManifestationEvent()`** — pure function in `app/lib/sefaz-manifestation.ts`.
   - Builds `envEvento` / `evento` / `infEvento`, with `Id="ID210210" + chNFe + "01"`.
   - Signs with XMLDSig: RSA-SHA1 and c14n 1.0 (what SEFAZ requires), referencing the `Id`.
   - Tested with a fixture `.pfx`, no network.
   - **New dependencies:** `xml-crypto` and `node-forge`. Forge is needed because Node cannot extract
     the key/certificate from a PKCS#12. The test `.pfx` uses MAC sha1 with 2000 iterations
     (legacy), which forge reads without depending on OpenSSL 3's legacy provider.
2. **`sendManifestation()`** — inside `app/lib/sefaz-client.ts`.
   - Reuses the mTLS transport; posts to `NFeRecepcaoEvento4` (production and homologação).
   - Parses `retEnvEvento`; `cStat` 135/136 and **573 (duplicate event)** are success — so it is
     idempotent if the accountant/ERP already manifested the same key.
   - One call only, no retry, same spirit as `distNsuQuery`.
3. **Wiring into `sefaz.nfe.received`** — after the job itself is built out.
   - On a `resNFe` with no matching `procNFe`, fire the Ciência.
   - Needs a persisted "ciência sent" state per access key, so it is not sent twice.

**Risks and constraints**

- **Irreversible and legally binding** under the client's CNPJ. Item 2 only runs against production
  with explicit approval, one invoice at a time, like the query-only test above.
- **Only ever `210210`.** Confirmation/unknown/not-performed (`210200`/`210220`/`210240`) have fiscal
  effect and stay a manual/owner decision.
- **Endpoint and event version unconfirmed:** the `NFeRecepcaoEvento4` URL in the AN and the
  `envEvento` `versao` (1.00) come from `sped-nfe`; confirm against the official WSDL before trusting
  them, as with `hom1`.
- **Onboarding:** for a new client the `210210` can only go out after they upload their A1 — reinforces
  activating the certificate as early as possible.
- **Old invoices (backfill):** manifestation has a deadline after authorization; the exact window is
  still to be confirmed before promising to recover history.
- **Third-party alternative:** FocusNF/Arquivei manifest automatically but charge per CNPJ — not
  chosen for the low-ticket goal.
- The open point about clients that already manifest through another system (above) is partly
  answered: the accountant's Ciência did not block our query. The cursor/one-software rule is still
  untested.

### Result of the first real queries and the first Ciência (2026-10-06)

All done by dev scripts against **production** with the store's e-CNPJ A1; the app itself stayed on
`SEFAZ_SOURCE=simulated`. Nothing about the live source is built.

- **`NFeDistribuicaoDFe` worked.** `scripts/dev/sefaz-dist-nsu.ts` from NSU 0 returned `cStat 138` with
  50 documents; the CNPJ's sequence starts at **NSU 199** (not 1) and `maxNSU` was 323. Three calls
  (199–248, 249–298, 299–323) fetched everything: 125 documents = 60 `procNFe`, 61 `resNFe`, 3
  `resEvento`. 55 of the 60 full notes were already captured; 5 were new. The query used 4 of the 20 per
  hour. XMLs were saved outside git (fiscal data).
- **A new note shows up fast, but only as a summary.** A note authorized at 15:55 was in SEFAZ as a
  `resNFe` less than 30 minutes later. The OESA note of 2026-10-06 (authorized 03:38) was **still a
  summary ~9 hours later** — nobody had registered a Ciência for it.
- **The Ciência releases the full XML.** `scripts/dev/sefaz-ciencia.ts` (dry run by default, `--send` to
  register) sent event `210210` for that single key to
  `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` (SOAP 1.2, action
  `…/NFeRecepcaoEvento4/nfeRecepcaoEvento`). Answer: HTTP 200, `retEnvEvento` `cStat 128` ("Lote de
  evento processado"). **The event-level `cStat` (135 vs 573) was not seen** (the first version of the
  script read the wrong response tag, `nfeResultMsg` instead of `nfeRecepcaoEventoNFResult`; fixed). A
  query from NSU 323 a few minutes later returned the same note as `procNFe` (NSU 325). So the endpoint,
  the event format and the signature were accepted, and the delay was minutes. Only one case: it cannot
  be proved that nobody else registered at the same time.
- **Signature without new dependencies.** The plan above assumed `xml-crypto` + `node-forge`. The script
  instead writes the event already in canonical form (C14N 1.0, RSA-SHA1/SHA1 digest), signs with
  `node:crypto`, and reads the key and certificate out of the `.pfx` with the `openssl` CLI (password via
  environment, never an argument). It is a dev script; the app module (`buildManifestationEvent`) is still
  to be written, and whether to depend on the `openssl` binary or on `node-forge` is open.
- **The permission layer blocks `--send`.** The Claude Code classifier treated the send as a real-world
  transaction; the owner ran it in their own terminal. Keep it that way: one note at a time, explicit
  approval, only `210210`.
- Still unknown: why 55 older notes arrived complete (the 2026-09-25 note says the accountant registered
  the Ciência; ask whether that is automatic), and the exact deadline to manifest an old note.

### Legal / compliance pendings and decisions (2026-09-26)

Not legal advice — this is the general understanding, to be confirmed with the client's accountant
and, before selling, with someone who drafts contracts.

**What the Ciência is, in plain terms.** The client declaring to SEFAZ "I am aware an invoice was
issued against my CNPJ". It does **not** say the goods arrived, the value is right, or that the
client accepts to pay (that is Confirmação, `210200`). It is a _non-conclusive_ manifestation: it
creates no debt or acceptance, and the client can still send `210220`/`210240` later. It is
irreversible (cannot be cancelled) but the mildest of the four events.

**Pending before enabling it for a real client**

1. **Ask the accountant:** is there any obligation or deadline for a conclusive manifestation in
   the client's state? Has anyone had trouble by giving only Ciência?
2. **Authorization clause in the terms of use/contract.** The event is signed with the client's A1
   certificate, i.e. their digital signature, so Custeio acts on their behalf. The terms must
   say the client authorizes Custeio to use the certificate to query their invoices and register
   Ciência da Operação. Adds to the certificate-custody concern above.
3. **Keep the current limits:** only `210210` is automatic; everything else stays the owner's
   decision; the first production test is one client of ours, one invoice at a time.

**To decide: invoices issued against the client's CNPJ that the owner never saw (fraud)**

- Someone can issue an invoice in another company's name. Automatic Ciência on everything would
  register "aware" of an invoice the owner never saw — it does not validate the invoice, but it does
  not question it either.
- For that reason we never send an automatic Desconhecimento (`210220`); that path stays the
  owner's decision.
- Possible future mitigation: notify the owner on WhatsApp when an invoice from an unknown supplier
  arrives (e.g. a CNPJ with no `SupplierItemMappings` and no previous invoices). Open: whether to
  hold the automatic Ciência for unknown suppliers until the owner answers, instead of only
  warning after the fact — that costs the item-level data until then.

**To decide / confirm: conclusive manifestation**

- Formally SEFAZ expects something conclusive after the Ciência. It is generally not mandatory, but
  there may be state- or operation-specific rules.
- Not known: the exact deadline, nor whether there is any consequence for never concluding. To be
  confirmed (see item 1 above). Related product decision already noted earlier: asking the owner
  "is this purchase right?" over WhatsApp could double as the conclusive manifestation.

## Blind spot: NFC-e purchases (model 65) are invisible to this whole pipeline

Found 2026-09-28, from a real receipt: a meat supplier who invoices Loja Piloto issues an
**NFC-e** (model 65 — "Nota Fiscal de Consumidor Eletrônica"), not an NF-e (model 55, everything
this document has assumed so far), even though the DANFE has the buyer's CNPJ printed on it.

- **`NFeDistribuicaoDFe` does not serve NFC-e at all** — confirmed against reference sources: the
  service only distributes NF-e and CT-e. This is structural, not a timing or manifestation
  question: no amount of polling, NSU cursor health, or Ciência da Operação will ever surface an
  NFC-e through this webservice, even with the recipient's CNPJ identified on the document.
  Verified directly: a production `distNSU` call that same day, run against Loja Piloto's
  real certificate (NSU 243–314, `tpAmb=1`), found the CNPJ of a supplier that only issues NF-e
  (Pão Ayres — including the exact invoice from the [stock-and-cmv.md
  idea](./stock-and-cmv.md#idea-a-supplier-that-only-invoices-at-months-end-not-implemented)) but
  zero documents from the meat supplier's CNPJ, across the whole batch.
- **Why a B2B purchase ends up as an NFC-e at all**: NFC-e is meant for over-the-counter sales to a
  final consumer, but a seller can still fill in the buyer's CNPJ on it — common with small/informal
  suppliers who sell to a business the same way they sell to any walk-in customer, rather than
  issuing a proper NF-e. The gap is **supposed to be closed**: Ajuste SINIEF 11/2025, changed by **30/2025**, forbids
  issuing NFC-e to a CNPJ recipient from **2026-01-05** (the date earlier noted here, 2026-05-04, was
  wrong); the exception is a simplified DANFE of an NF-e for in-person sales and home deliveries.
  Yet the receipt of 2026-09-28 (Açougue do Tião) still shows a 14-digit "consumidor" — so either the
  number is not a CNPJ recipient inside the XML, or the supplier is not complying. Worth checking in
  the XML itself, and a good argument for asking that supplier for an NF-e.

- **What we _could_ do, not recommended for the MVP**: each NFC-e carries a QR code pointing at its
  issuing state's own public consulta page (no certificate needed — it exists precisely so any
  consumer can verify a receipt), which could in principle be queried by access key. Rejected for
  now: it is a per-state page, not a national API, so it would mean one integration per state
  rather than the one national webservice everything else here relies on — real ongoing maintenance
  for what is, so far, a single small supplier.
- **What to do instead**: treat an NFC-e purchase like any other note we cannot pull automatically —
  the manual/"notas futuras" path from
  [stock-and-cmv.md](./stock-and-cmv.md#idea-a-supplier-that-only-invoices-at-months-end-not-implemented)
  (the owner reports it, or sends a photo we read the QR/text from) rather than a live SEFAZ lookup.

### Research on "capture NFC-e by the buyer's CNPJ" (2026-10-02)

Searched for any state-level service that lists the NFC-e issued to a CNPJ. Result: **none found, and
none for DF**.

- Nationally, `NFeDistribuicaoDFe` serves only NF-e and CT-e (reconfirmed).
- The NFC-e XML can officially be downloaded only by the **issuer**, the **identified consumer** (with a
  certificate) and parties named in `autXML` — **by access key, per state**, with each state setting its
  own rules. There is no "list everything issued to my CNPJ".
- Commercial capture of NFC-e exists in a few states (Jettax lists BA, MG, PR, PB, SC, SP; **DF is not
  among them**), through the client's certificate; whether it covers purchases or only the client's own
  sales was not clear from its page.
- A paid API reads one SEFAZ-DF NFC-e by query (Infosimples): returns issuer, items with quantity and
  prices, totals and payment. So **a single note can be read from its key/QR code in DF**; a list by
  CNPJ cannot.
- Open to verify: whether Loja Piloto's A1 certificate, as identified consumer, can fetch the full XML of a
  note by its key from the DF webservice (a spike with the real key of a received NFC-e).

**Checked on the real note (2026-10-02).** The DF public consultation (opened by hand by the owner) shows
the NFC-e of 2026-09-28 from the meat supplier with the **Consumidor CNPJ = Loja Piloto's own CNPJ
(00.000.000/0001-00)** — so the buyer _is_ identified inside the document, **after** the 2026-01-05 ban on
NFC-e to a CNPJ (the supplier is not complying, or DF does not enforce it). Its access key is valid (check
digit matches): UF 53, 2026-09, issuer CNPJ 11.111.111/0001-11, model 65, series 1, number 876. The note has
one item ("CARNE", `Qtde 1000.0000 UN`, unit R$ 1,00, total R$ 1.000,00) — no weight, no types. The
consultation portal is an Angular app behind a Cloudflare challenge (made for people, not for scripts), so it
is **not** something to scrape; a programmatic read would go through the SEFAZ webservice with the
certificate (not built, unverified for model 65) or a paid API.

Conclusion: no automatic capture by CNPJ for NFC-e. The structural fix is the supplier emitting NF-e
(forbidden otherwise since 2026-01-05); until then, one action per purchase (photo/QR or a typed
purchase). And an NFC-e like the meat supplier's (one line, no weight) would not carry what stock needs
even if captured.

Sources: [Focus NFe — NFC-e não poderá ser emitida para CNPJ](https://focusnfe.com.br/blog/nfce-nao-podera-mais-ser-emitida-para-cnpj/),
[Ozai — vedação adiada para 5/1/2026](https://www.ozai.com.br/vedacao-nfc-e-cnpj-adiada-5-janeiro-2026/),
[Espião NF-e — baixar XML NFC-e](https://espiaonfe.com.br/blog/baixar-xml-nfc-e-pela-chave-de-acesso-direto-da-sefaz),
[Jettax — captura de NFC-e por estado](https://www.jettax.com.br/blog/captura-automatica-de-nfc-e-em-quais-estados-a-jettax-ja-busca-documentos/),
[Infosimples — SEFAZ DF NFC-e](https://infosimples.com/consultas/sefaz-df-nfce/).

## Sources

<!-- cspell:disable -->

- [Manual de Integração - Contribuinte versão 4.01](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=d/NN9SSgick%3D)
- [Nota Técnica 2014.002 — Web Service de Distribuição de DF-e](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=wLVBlKchUb4%3D)
- [sped-nfe (nfephp-org) — método DistDFe](https://github.com/nfephp-org/sped-nfe/blob/master/docs/metodos/DistDFe.md)
- [sped-nfe (nfephp-org) — método Manifesta](https://github.com/nfephp-org/sped-nfe/blob/master/docs/metodos/Manifesta.md)
- [FlexDocs — Manifestação do Destinatário](https://flexdocs.net/guia-nfe/manifestacao-destinatario/)
- [L2Maker — Consulta de NF-e destinadas e Distribuição](https://www.l2maker.com.br/documentacao/2016/09/consulta-de-nf-e-destinadas/)
- [node-mde — biblioteca Node.js de referência para MDe](https://github.com/lucashpmelo/node-mde)
- [stoix-dev/sefaz-webservices-postman — coleção Postman SOAP 1.2 + mTLS e-CNPJ](https://github.com/stoix-dev/sefaz-webservices-postman)

Researched 2026-09-22 (rate limits, historical backfill, and the ingredient-capture plan):

- [Espião NFe — Quais são as regras para consultar NF-e na SEFAZ?](https://espiaonfe.com.br/blog/quais-sao-as-regras-para-consultar-nfe-na-sefaz)
- [Qive/Arquivei — Rejeição 656: Consumo Indevido](https://qive.com.br/blog/consumo-indevido-consulta-nfe)
- [Focus NFe — Como consultar suas NFes recebidas e cuidados necessários](https://focusnfe.com.br/blog/como-consultar-suas-nfes-recebidas-e-cuidados-necessarios/)
- [Tributos.io — Serviço NFeDistribuicaoDFe: Consulta DF-e por NSU e Chave](https://tributos.io/blog/legislacao-e-normas/servico-nfedistribuicaodfe-consulta-df-e-por-nsu-e-chave-2024)
- [Tributos.io — NFe: Distribuição de DF-e via Web Service - Acesso e NT 2014.002](https://tributos.io/blog/legislacao-e-normas/nfe-distribuicao-de-df-e-via-web-service-acesso-e-nt-2014-002-2024)
- [Bluesoft — Identificação Automática de Produtos na Importação de XML de Integração](https://ajuda.bluesoft.com.br/sistema/melhoria/melhoria-estoques-e-nf-e-identificacao-automatica-de-produtos-na-importacao-de-xml-de-integracao/151890)
- [Programa NEX — Conversão de unidades durante a entrada de estoque via XML](https://ajuda.programanex.com.br/tutorial/entrada-de-estoque-via-xml-conversao-de-unidades)
- [Cosmos (Bluesoft) — Catálogo de Produtos, GTIN, NCM, Tributação e Marca](https://cosmos.bluesoft.com.br/api)
- [GS1 Brasil — Base de produtos nacionais (Cadastro Nacional de Produtos)](https://apicnp.gs1br.org/api-portal/content/base-de-produtos-nacionais)

Researched 2026-09-22 (Tier 4 LLM hosting decision — Azure OpenAI vs. self-host vs. Gemini free
tier):

- [Azure OpenAI pricing in 2026: models, PTUs, and what it actually costs — CloudZero](https://www.cloudzero.com/blog/azure-openai-pricing/)
- [Azure gpt-4o-mini Pricing Calculator — Helicone](https://www.helicone.ai/llm-cost/provider/azure/model/gpt-4o-mini)
- [Azure OpenAI Model Regional Availability](https://model-availability.azurewebsites.net/)
- [Foundry Models | Microsoft Azure](https://azure.microsoft.com/en-us/products/ai-foundry/models)
- [Azure AI Foundry vs. Google Vertex AI: Architecture & Fit [2026] — Atlan](https://atlan.com/know/ai-agent/ai-agent-applications/azure-ai-foundry-vs-google-vertex-ai/)
- [Ollama v0.2.+ with phi3:mini increased RAM consumption — GitHub Issue](https://github.com/ollama/ollama/issues/5767)
- [Phi-4 Mini: Microsoft's Best Small Model (3.8B) — Guide & Benchmarks](https://localaimaster.com/models/phi-4-mini)
- [Gemini API Free Tier Rate Limits 2026 — AI Prompt Generator Hub](https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits)
- [Does Google Gemini Free Tier Train on Your Data? — BSWEN](https://docs.bswen.com/blog/2026-03-23-gemini-free-tier-data-privacy/)

Researched 2026-09-22 (localhost testing, homologação vs. produção):

- [TreeUNFe — Qual a diferença entre ambiente de produção e homologação?](https://treeunfe.com.br/blog/qual-a-diferenca-entre-ambiente-de-producao-e-homologacao)
- [NS Tecnologia — Diferenças entre o ambiente de Homologação e Produção](https://blog.nstecnologia.com.br/diferenca-entre-o-ambiente-de-homologacao-e-producao/)
- [Portal da Nota Fiscal Eletrônica — Web Services](https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo%3D)
<!-- cspell:enable -->
