# Jobs

## Scope

The Jobs page is the **support console**: it shows every queued/running/finished job, why one
failed, and where a stuck one stopped. It is not a product screen — the owner of a hamburgueria
never sees a job; they see stock and margin, and (later) WhatsApp answers.

Every job is a row in the `jobs` collection (model: [`app/models/jobs.ts`](../../app/models/jobs.ts))
plus a Bull entry `{ jobId }` in Redis — Mongo holds the state, Redis only coordinates. See
[Architecture](../architecture/).

## Routes

- UI route: `/system/jobs`
- Backend features: `jobs.get_all` → `/api/jobs/list`, `jobs.get_one` → `/api/jobs/[id]`,
  `jobs.create` → `/api/jobs/create`, `jobs.retry` → `/api/jobs/[id]/retry`, `jobs.download` →
  `/api/jobs/[id]/download`
- Service: [`app/lib/services/jobs.ts`](../../app/lib/services/jobs.ts) (list + detail),
  [`app/lib/jobs/service.ts`](../../app/lib/jobs/service.ts) (create + enqueue),
  [`app/lib/jobs/runner.ts`](../../app/lib/jobs/runner.ts) (what the worker runs)

## Job kinds

| Kind                       | What it does                                                                                                                                                                                                                                                    | Started by                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `users.export.csv`         | Accounts CSV, newest sign-in first, with `last_sign_in_at`                                                                                                                                                                                                      | System/Support, this page                         |
| `organizations.export.csv` | Tenants CSV: `organization_id`, `name`, `status`, `billing_status`, `created_at`                                                                                                                                                                                | System/Support, this page                         |
| `sefaz.nfe.received`       | NFe capture → stock credit + Tier 1/2 auto-draft, from a manual upload or "Buscar na SEFAZ" (simulated source; pauses on the quota and resumes via [Crons](./sefaz-nfe.md#crons-system--crons); applies cancellation events) — the live source is not built yet | Tenant, "Capturar insumos" on [Stock](./stock.md) |

| `pos.catalog.sync` | Alloy menu → `PartnerProducts`, one `getproducts` request per run (never touches `recipe`) — see [Products](./products.md) | Tenant, "Sincronizar cardápio" on Products |

Two more kinds the product needs are **not implemented yet** — only the models they write to are:

| Kind (planned)              | Role                                                                 | Spec                                  |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `pos.order.received`        | Alloy order webhook → stock debit by recipe, `Orders.calculatedCost` | [Stock and CMV](./stock-and-cmv.md)   |
| `whatsapp.message.incoming` | Owner's WhatsApp question → answer inside the 24h window             | [WhatsApp](./whatsapp-quick-query.md) |

## The report kinds are System-only

The two CSV reports are ours, not a tenant's work, and
[`app/lib/jobs/system-only-kinds.ts`](../../app/lib/jobs/system-only-kinds.ts) is the one list that
says so. Three things make a merely _visible_ row a leak:

- The reports span **every organization the requester can reach** — for a System account, the
  whole platform — plus every user who belongs to no organization.
- The job is stamped with a single arbitrary organization id at creation
  (`authorizedOrganizationIds[0]`), so a platform-wide report lands inside some tenant's scope by
  accident of ordering.
- The download route streams the finished CSV to anyone who can reach the row.

The _page_ (`/system/jobs`) lives under `/system`, guarded by
[`app/(protected)/system/layout.tsx`](<../../app/(protected)/system/layout.tsx>), and **every job
route repeats `requireSystemAccess`** because the layout shapes the UI and the route shapes the
request. The list still matters even with the page being System-only: it keeps a platform-wide
report out of a tenant-scoped query, not just off a tenant's screen — `sefaz.nfe.received` is the
first kind that is _not_ on it, since it is a tenant's own stock work, scoped by `storeId`
(enqueued from its own route, `/api/raw-ingredients/capture`, not from this page's create action).
A System/Support session can still see its rows here for support purposes — the page is a console
over every job, tenant or platform.

## Adding a kind touches four places

A job kind is only runnable when all four line up:

1. `app/lib/jobs/types.ts` — the `JobKind` union and its payload
2. `app/lib/jobs/schemas.ts` — the payload schema, in `jobPayloadSchemas`
3. `app/jobs/registry.ts` — the handler
4. `app/api/jobs/create/route.ts` — the accepted union, for kinds a user starts by hand (webhook
   and scheduled kinds are enqueued by their own route/scheduler instead)

Dispatch is table-driven off `jobPayloadSchemas`, so a kind cannot compile without a payload
schema, and `__tests__/server/jobs-dispatch-tables.spec.ts` fails if the tables drift apart. The
filter dropdown reads `FILTERABLE_JOB_KINDS` (in `components/table-jobs.tsx`) and the labels in
`jobs.filters.kindLabels`, so a new kind has to be added to both before it is filterable.

Ad-hoc kinds live in `ADHOC_JOB_KINDS` in
[`components/job-create-modal.tsx`](../../components/job-create-modal.tsx) and are validated again
server-side by the discriminated union in `app/api/jobs/create/route.ts`.

## Row actions

- **Detail (eye)** — the job's step log, errors, payload and attempt history.
- **Download** — for a finished report kind, streamed through the blob proxy. Written to the audit
  log as `job.export_download`.
- **Retry** — on failed, canceled or done jobs; resets the status and re-enqueues. Written to the
  audit log as `job.retry`. Bull's retry policy comes from the `APP_BULL_*` env knobs, never from
  literals in the model.

## Why accounts and tenants are separate reports

They answer different questions. The users export lists people and, as an attribute of each
person, which organizations they belong to. It cannot say which tenants are `suspended` or
`past_due` — that is a property of the organization, not of anyone's membership. Splitting them
also keeps the organizations CSV free of user rows when the question is about billing or capacity.
The organizations export never includes credentials (`Stores.apiKey`, encrypted at rest — see
[Stores](./stores.md)).

## Retention: two places, two answers

A job lives in two stores that are easy to conflate:

- **Redis (Bull)** is only the queue. A completed job there is of no use to us: a support retry
  never reuses it, it builds a **new** Bull job from the `payload` and `config` saved on the Mongo
  document (`app/api/jobs/[id]/retry`); the automatic attempts (3, with a backoff) happen while the
  job is still active or waiting, so they need nothing kept after completion; and resuming does not
  depend on it either — the SEFAZ search continues from `Stores.sefazUltNsu`, and the catalog sync
  is an idempotent full snapshot with nothing to resume.
  **Decision (2026-09-26): remove on completion, keep failures.** That is what
  `app/lib/bull/queue.ts` already defaults to (`removeOnComplete: true`, `removeOnFail` up to
  `APP_BULL_KEEP_FAILED_JOBS`, old failures cleaned by the worker). The enqueue routes for the
  capture upload, "Buscar na SEFAZ", "Sincronizar cardápio" and the System create action had copied
  `removeOnComplete: false` from one another and were overriding it; they no longer do.
- **Mongo (`jobs`)** is the real record — `payload`, `logs`, `result`, `status` — and what the Jobs
  page, the retry action and "Última sincronização" read. It is worth keeping, but **today it has no
  retention at all**, and one kind makes that costly.

### Planned, not implemented

1. **Strip the XML content from an upload job once it succeeds.** `sefaz.nfe.received` in upload mode
   stores the content of every file inline in `payload.files` (up to 20 files of 2 MB) and again in
   `params.payloadOriginal`, so a single job can weigh several MB, forever. After a successful run
   only the file names, counts and the per-file result need to stay; a failed job keeps its
   content, because a retry re-reads it from there.
2. **A TTL on finished jobs**: about 60–90 days for `done`, longer for `failed` (the ones support
   investigates), with the number set by an environment variable like the other retention knobs.
   Automatic deletion has no undo: take a [backup](../operations/backup.md) first and see
   a retention policy for the rest of the data is still to be decided.

Neither is built; item 1 is the one that pays for itself first.

## Testing

- `__tests__/server/jobs-dispatch-tables.spec.ts`, `jobs-runner.spec.ts`,
  `jobs-get-all-route.spec.ts` — dispatch, execution, listing scope.
- `__tests__/server/jobs-export-users-organizations.spec.ts`,
  `jobs-export-organizations.spec.ts` — the two reports.
- `__tests__/client/job-detail-*.spec.tsx` — the detail view.

## Crons are jobs too (2026-10-02)

Sistema > Jobs is where everything that happens in the background is read, so the runs of the workers' crons
(`app/lib/crons`, tuned in Sistema > Crons) are recorded there as well, as jobs of kind `cron.<key>`
(`cron.sefaz.auto-sync`, `cron.queue.cleanup`):

- **Platform-level**: no organization (`Jobs.organizationId` is optional now) and System/Support only
  (`jobs/system-only-kinds.ts`). A System session looking at every organization sees them; picking an
  organization narrows to that organization's jobs; a tenant never sees them.
- **Live**: the job is opened as `running` before the handler starts and closed `done` / `failed` after it,
  with the summary line, the duration and the error when there is one (`services/cron-job-records.ts`).
- **An idle success leaves no trace**: a handler returns `{ summary, idle }` and an idle run (nothing started,
  nothing removed) deletes its own record — a cron that ticks every few minutes would otherwise bury real jobs
  under "0 started". The Crons screen still shows its last result. Work done and failures stay.
- **Bounded**: `queue.cleanup` also removes cron run records older than 14 days.
- Recording is bookkeeping: if writing the record fails, the cron still runs.

## New job kinds (2026-10-02)

| Kind                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pos.order.received`    | One PDV webhook delivery (already in `pos_events`) → `Orders` row and, once accepted, the stock debit by recipe; a cancellation gives it back. See [stock-and-cmv.md](./stock-and-cmv.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pos.orders.reprocess`  | Settles again every debited order of a store that still has lines without a recipe, against the recipes as they are now ("Reprocessar incompletos" on Pedidos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ai.ingredients.review` | The AI (Haiku 5.5) looks at each unreviewed ingredient with only the few Alloy menu lines that look like it (`app/lib/menu-evidence.ts`: the prompt does not grow with the menu) and records `aiReview` plus, when confident, `inOperation` (the owner overrides it in the edit form). Ingredients already in a recipe are skipped. Resumable, capped by a spending limit ("Analisar com IA" on Estoque). After the review it also looks for duplicates (suggestions to merge) and groups variations under a base ingredient (`familyOf`, once per ingredient, `ingredient-families.ts`). It also starts by itself when a captured note creates new drafts (`sefaz.nfe.received` → `ingredient-review-trigger.ts`, one per store at a time), and merges **without asking** only the safe case: a high-confidence group where the kept ingredient is settled, every other is still a draft, and the unit is the same (`isSafeAutoMerge`); the rest stays a suggestion. Automatic merges are in the job result and in the audit log (`raw_ingredients.auto_merge`). |
