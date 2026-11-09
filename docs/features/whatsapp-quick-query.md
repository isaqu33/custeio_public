# WhatsApp — quick query and alerts

Technical mapping of step 4 of the pipeline described in [`CLAUDE.md`](../../CLAUDE.md): quick
queries over WhatsApp (Meta's official API) so the owner can check stock and margin without
opening a dashboard. Reference for implementing the `whatsapp.message.incoming` job.

> Researched on 2026-09-19 from Meta's public documentation and price comparisons from Brazilian
> BSPs. **API decision made** (official, see below); **AI decision deliberately still open** — both
> paths are documented side by side.

## Decision: the official API (Meta Cloud API), not Evolution API

`CLAUDE.md` used to name Evolution API, written before we weighed the risk (it now says the
official Meta API, in line with this decision). Evolution API automates WhatsApp through
**Baileys** — a reverse-engineered WhatsApp Web protocol, not Meta's official API. The real risk:
**the owner's number can be banned** if WhatsApp detects the automation pattern — and it is the
owner's personal/business number, not a disposable one of ours. For a feature meant to be
"invisible" and dependable in the client's day to day, that risk is not worth the savings.
**Decision: use Meta's official API (Cloud API).**

## Architecture: one Custeio number, not one per store

Unlike SEFAZ (where each `Store` needs its own certificate), the recommended design here is the
opposite: **a single WhatsApp Business Account (WABA) verified in Custeio's own name**, with one
(or a few) phone number(s) — not a WABA per `Store`.

- Meta's business verification (documents: CNPJ, proof of address, legal representative's ID) is
  done **once, by Custeio**, not by each hamburger-joint owner. Asking every client (a segment
  with no back office) to go through Meta's business verification would be as bad an onboarding
  friction as asking for an A1 certificate twice.
- `Stores.whatsappNumber` (already in the model) becomes the **routing key**: when a message
  arrives on Custeio's single number, the job resolves the sender against
  `Stores.whatsappNumber` to know which store the question is about — it is not the number that
  authenticates with Meta, it is the number that identifies the tenant.
- Same "shared credential, per-tenant routing" pattern we already use with
  `ALLOY_INTEGRATOR_TOKEN` (see [alloy-api.md](./alloy-api.md)) — except here there is not even a
  per-store token; routing is by the sender's number alone.

## How to get access

1. A verified **Meta Business Manager** account in Custeio's name — verification takes 24h to 5
   business days and requires the CNPJ, proof of commercial address and the legal
   representative's ID.
2. Create an app at **developers.facebook.com**, enable the WhatsApp product, configure the
   webhook (URL + custom verification token).
3. Register a phone number **that is not in use on regular WhatsApp/the Business App** — Meta
   validates it by SMS or voice call.
4. **Before** business verification: a limit of 2 numbers and 250 conversations/day — enough for
   development/testing. **After**: up to 20 numbers per WABA and 1,000 conversations/day (a higher
   limit can be requested as volume grows).
5. Going straight to Meta (Cloud API) vs. using a **BSP** (Twilio, 360dialog, Gupshup, Wati,
   etc.): a BSP charges a separate monthly fee (~R$200–1,200/month in Brazil) in exchange for a
   template-management UI and simpler onboarding. Going direct has no such fee, but means building
   template/webhook management ourselves — a cost-benefit decision for when we implement, not
   closed now.

## The 24h window — and why it matters for our use case

- When the owner sends a message, a **24h window** opens in which Custeio can reply freely
  ("free-form" message, no pre-approved template). Each new message from the owner restarts the
  window.
- A **quick query** ("Estoque Queijo") is exactly this case: the owner initiates, we answer inside
  the window — no Meta-approved template needed.
- A **proactive alert** (stock-out, `RawIngredients.minAlertStock` — see
  [stock-and-cmv.md](./stock-and-cmv.md)) is the opposite case: Custeio speaks first, with the
  owner having sent nothing in the last 24h. That **requires a template pre-approved by Meta**
  (category most likely `utility` — an operational alert, not advertising) — the text cannot be
  improvised, and template approval has to happen ahead of time, not in production.

## Price — and a change already in force by the time this is built

Message categories: `marketing`, `utility`, `authentication`, `service` (the only one initiated by
the customer). Approximate ranges in Brazil (2026, several sources; exchange rate and exact value
vary — treat as an order of magnitude, confirm before projecting cost per client):

| Category         | Who initiates                         | Approximate price (BR)    |
| ---------------- | ------------------------------------- | ------------------------- |
| `service`        | Customer (our "quick query" case)     | **Free until 2026-09-30** |
| `utility`        | Business (our "proactive alert" case) | ~R$0.03–0.05              |
| `authentication` | Business                              | ~R$0.03–0.19              |
| `marketing`      | Business                              | ~R$0.31–0.38              |

**This changes from 2026-10-01** — twelve days after this was researched, so **already in force
when the feature is really built**: `service` messages (the quick query, our main use) stop being
free and cost the same as `utility` does today (~R$0.03–0.05 per message). In practice this
simplifies the decision — reactive and proactive cost about the same from that date, so it is not
worth designing the feature around "forcing everything inside the 24h window" to save money; the
per-message cost has to enter the unit economics of Custeio's plan either way.

## AI in the reply — the two options, decision left open on purpose

### Option A — fixed-command bot (no AI)

- The owner sends something with a recognizable pattern ("estoque queijo", "margem x-burger") — the
  job matches the message against `RawIngredients.name`/`PartnerProducts.name` by rule (prefix +
  simple fuzzy match, such as Levenshtein, to tolerate typos).
- Zero cost beyond the WhatsApp message itself, instant reply, 100% predictable, easy to test.
  Weakness: any phrase outside the expected pattern is not understood — the owner has to learn
  "the right way to ask".

### Option B — AI (LLM) interpreting free language

- The owner writes naturally ("quanto de queijo ainda tem?", "como tá a margem esse mês?") — an LLM
  extracts the intent and parameters, calls the right function (a query on
  `RawIngredients`/`Orders`) and writes the reply.
- More flexible (tolerates any way of asking, can combine more than one question in the same
  message), but adds: extra latency (a call to an AI API before replying), a per-message cost on
  top of the WhatsApp cost (tokens), and a new infrastructure dependency.
- A separate note, not yet investigated: from 2026-08-01 Meta started charging for "Meta Business
  Agent messages" — we have not confirmed whether that applies to a bot using **our** AI (e.g.
  Claude) answering through regular WhatsApp, or only to an AI agent hosted **by Meta itself**.
  This needs clarifying before choosing Option B, so we do not get a surprise charge from Meta on
  top of the AI provider's cost.

Neither has been chosen yet — it waits until we design the job for real.

## Relevance to the Custeio jobs

| Job (`app/jobs/`)           | Role                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp.message.incoming` | Receives Meta's webhook, resolves the sender against `Stores.whatsappNumber`, answers the query (Option A or B above) inside the 24h window                                           |
| _(no name yet)_             | Proactive stock-out alert job — fires outside the 24h window, through a pre-approved `utility` template; see [stock-and-cmv.md](./stock-and-cmv.md) for the trigger (`minAlertStock`) |

## Open / not confirmed

- **Exact value of each price category** — sources differ a little (e.g. `utility` between
  R$0.034 and R$0.05); confirm directly at [Meta for Developers — Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
  before projecting cost per client/plan.
- **"Meta Business Agent" charge** (2026-08-01) — we do not know whether it affects a bot with its
  own AI running behind the regular Cloud API.
- **Direct Cloud API vs. BSP** — cost-benefit decision not closed; direct is cheaper but means
  building template/webhook management ourselves, a BSP costs a monthly fee but delivers that
  ready-made.
- **Fuzzy matching of ingredient/product names in Option A** — algorithm not decided (plain
  Levenshtein? substring search? a Mongo text index?) — left for when the job is really
  implemented.
- **Approval of the proactive-alert template** — has to be submitted to and approved by Meta well
  in advance; it cannot be tested at the last minute in production.

## Idea for when this phase starts: the kitchen reports by voice (2026-10-06)

The owner wants the people in the kitchen to tell Custeio things by voice message on WhatsApp instead of
typing in the app. The motivating case is the **batch of a preparation** ("made 4 kg of Molho da Casa
today", "the last one ran out, made another") — see the preparation-batch feature in the roadmap, which
must exist first as a screen: voice is only another way to enter the same record.

Other candidates from the same conversation: add or adjust an ingredient quantity ("added 13 g slices of
cheddar"), and register a purchase that no NF-e covers. Voice notes mean transcribing audio and
matching the spoken name to an ingredient/preparation, so this belongs to Option B (AI) above and has to
confirm back before writing ("Molho da Casa, 4 kg — confirm?"). **Not built; AGIR layer.**

## Photo of receipts and voice (decided 2026-10-10)

Receipts the NF-e capture cannot see (an NFC-e from a supplier that issues the small cupom, a hand-written
slip) and voice notes are **both entered through WhatsApp, not through an upload screen in the app**: the
client sends the photo or the audio to the Custeio number, the AI reads it, and nothing is written before
the client confirms. Until this phase, those purchases keep going through "Registrar compra". Design,
what needs AI and what does not (the sum of the items and the 44-digit access key verify the reading
without it), and the open questions: [receipt-capture-whatsapp.md](./receipt-capture-whatsapp.md).
**Not built; AGIR layer.**

## Test bench results (2026-10-12): which model, how much it costs

`scripts/dev/ai-eval.ts` (cases and plain-rule grading in `scripts/dev/ai-eval-cases.ts` and
`ai-eval-grade.ts`; invented data only). Stage 1 is routing (the typed function and its arguments, or
rightly none: 71 messages with typos, slang, voice transcripts, two intents, items that do not exist and
attempts to break the rules); stage 2 is the reply written from a function result (shows the returned
numbers, invents none, flags incomplete data, never says a proposal was saved before confirmation).

| Model, effort     | Routing  | Reply | US$ / call | R$ / call |
| ----------------- | -------- | ----- | ---------- | --------- |
| Haiku 5.5, low    | 70/71    | 7/8   | 0.00040    | ~0.002    |
| Haiku 5.5, medium | 69–71/71 | 8/8   | 0.00041    | ~0.002    |
| Sonnet 5.5, low   | 71/71    | 8/8   | 0.0076     | ~0.04     |

- **Haiku 5.5 is enough for routing and replies** and costs ~19x less than Sonnet 5.5; a client with 900
  messages a month costs a few reais (routing plus the reply call). Sonnet stays for harder jobs (reading a
  receipt photo).
- **Runs vary by 1–2 cases**: a decision needs repeated runs, not one.
- **The prompt is sensitive**: an instruction to ask for confirmation after a proposal made the model ask in
  text without calling the function; the fix was to say "call the function FIRST". Re-run the bench before
  and after any prompt change.
- **Findings for the product**: "estragou" has no exact reason in Avarias (only expired, breakage,
  receiving damage, other); a nickname such as "hambúrguer" is ambiguous (sandwich or patty); the model
  sometimes adds a second read (about 6% of messages) and sometimes leaves a figure out.
- **Design consequence**: do not trust the model with the numbers. Run `gradeReply`-style checks at runtime
  (every number in the reply must come from the function result) and fall back to a template when it fails.

## Sources

<!-- cspell:disable -->

- [Pricing on the WhatsApp Business Platform — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [WhatsApp Business Platform 24 Hour Rule — Enchant](https://www.enchant.com/whatsapp-business-platform-24-hour-rule)
- [WhatsApp Business Messaging: Free-form messages — Infobip Docs](https://www.infobip.com/docs/whatsapp/message-types-and-templates/free-form-messages)
- [WhatsApp Pricing 2026: October Service-Message Cost — EngageLab](https://www.engagelab.com/blog/whatsapp-pricing-2026-service-message-cost)
- [Preços da API do WhatsApp Business no Brasil (2026) — Eazybe](https://eazybe.com/blog/whatsapp-business-api-pricing)
- [WhatsApp Business API Custo Brasil 2026 — Geek Academy](https://blog.geekacademy.site/blog/whatsapp-business-api-custo-brasil)
- [Como Criar um App no Meta Developers Para WhatsApp Business API — Micael Garcez](https://micaelgarcez.com.br/notes/como-criar-app-meta-developers-whatsapp-business-api)
- [Como configurar a WhatsApp Cloud API em 2026 — JetChat](https://jetchat.com.br/whatsapp-business-api-e-cloud/instalacao-whatsapp-cloud-api/)
<!-- cspell:enable -->
