# Upcoming Implementations & AI Differentiators (Custeio)

This document records the high-impact features designed for Custeio, building on the Bull queues
and the WhatsApp integration (Meta's official Cloud API, see
[whatsapp-quick-query.md](./features/whatsapp-quick-query.md)). The AI layer they need is not in
the app today (see [current-state](./architecture/current-state.md) for what exists).

---

## 1. AI Auto-Mapping of Ingredients (Smart Onboarding)

- **Goal:** Eliminate the manual friction of configuring the NFe → recipe "mapping" (De/Para).
- **Trigger:** Ingestion of a purchase XML (NFe) with items not yet mapped, or the initial import
  of the Alloy menu.
- **Mechanics:**
  - The pipeline sends the NFe item's raw description (`xProd`), commercial unit (`uCom`),
    quantity (`qCom`) and NCM to the AI.
  - The AI cross-references them with the list of ingredients registered in the organization and
    infers:
    1. The matching ingredient (e.g. `CX POLENGI CHED BL 10X1KG` -> `Queijo Cheddar`).
    2. The standard stock unit (`g`, `ml`, `un`).
    3. The mathematical conversion factor (e.g. 1 box = 10,000g).
    4. The confidence level of the inference (0-100%).
  - It fires an objective notification for one-click validation ("Yes / Adjust").
- **Impact:** Cuts onboarding time from days to under 2 minutes.

---

## 2. Silent Purchase & Margin Auditor (NFe Sentinel)

- **Goal:** Immediately flag ingredient cost increases that crush the profit of POS sales.
- **Trigger:** Completion of the processing of a new NFe (`sefaz.nfe.received`).
- **Mechanics:**
  - The worker detects when an ingredient's unit cost rose above a configured tolerance margin
    (e.g. > 5%).
  - The AI evaluates the cascading impact on every recipe (`PartnerProduct.recipe`) that consumes
    that ingredient.
  - It synthesizes a direct financial alert on the manager's WhatsApp:
    > _"The kilo of the patty went from R$ 32.00 to R$ 38.50 on the Frigol invoice. If you keep the
    > Double Smash Burger at R$ 34.90, your net margin drops from 61% to 49%. Suggestion: raise the
    > price to R$ 37.90 or negotiate the volume with the supplier."_
- **Impact:** The product pays for itself with the first alert about an abusive supplier price
  increase.

---

## 3. Unfiltered Cash Close (Daily Executive Briefing)

- **Goal:** Deliver a concise daily balance of the operation straight on WhatsApp, without
  requiring access to dashboards.
- **Trigger:** A job scheduled after the shift closes (e.g. 01:00 AM), or a text/audio command from
  the manager on WhatsApp.
- **Mechanics:**
  - It consolidates the shift's data: total sold in Alloy, the real CMV calculated from the
    fractional deductions, deviations and items with critical stock.
  - The AI generates a 4-to-5-line executive summary in a pragmatic tone:
    - Gross revenue vs. the day's total CMV (%).
    - The most profitable dish and the dish that consumed the most margin.
    - A stock-out alert for the next day (e.g. "Bacon reaches a critical level tomorrow at 9 PM").
  - (Optional) TTS audio generation, sent directly on WhatsApp.
- **Impact:** Creates a daily usage habit and maximum retention (zero churn).

---

## 4. WhatsApp Customer Win-back (Recuperação de clientes)

**Stage: AGIR, on top of ENTENDER (order history per customer). P2 — not started, no code.** It does not
improve cost, loss, forecast or purchasing, so it is a separate module / sales differentiator, not core.

- **Goal:** Bring back customers who stopped ordering, with an offer that fits what each one bought, instead
  of one blast for everybody.
- **Mechanics:**
  - Select customers with **no order in the last 30 days** **and** a recorded permission to receive offers.
  - Start with a **small test group**; compare its return rate before widening.
  - Send one message through the official WhatsApp Cloud API and **honour the opt-out** ("SAIR" stops all
    further messages immediately).
  - The AI picks the offer from the customer's **previous order** (favourite product / usual ticket) so the
    messages are not identical; the choice and its reason are stored (explain everything).
  - Result measured in R$: orders and revenue returned vs. the cost of the offer.
- **What the Alloy data allows (checked 2026-10-12):**
  - **Confirmed on a real site delivery order (2026-10-12, order 1688, `id_provedor: null`):** the `usuario`
    block carries `nome`, `sobrenome`, `telefone` (DDD + 9 digits, no country code), `telefone_codigo_pais`
    (55), `telefone_digits`, a reversed `telefone_digits_rev` (Alloy's search aid), `whatsapp_digits`
    (**empty** — the phone is the registered one, not a confirmed WhatsApp number), `cpf` and `email` (both
    `null` there), `data_nascimento`, `genero`. WhatsApp number = `55` + `telefone`. There is **no customer
    id**: the natural key is the normalised phone. The CPF also appears at `dados_pedido.cpf_cnpj`, and the
    address / coordinates come complete — the feature needs neither.
  - Custeio masks all of it today (`app/lib/alloy-webhook.ts`) and has **no customer entity**.
  - Still unconfirmed: counter orders (can arrive as "Cliente Não Informado", no contact) and iFood / 99Food
    (phones probably masked proxies) — **check on a real payload of each**.
  - **No consent field.** `usuario` has no marketing opt-in, and `desliga_notificacoes` is `null` in every
    stored event and in order 1688; its meaning is unknown. Alloy cannot prove an opt-in, so **Custeio must
    collect it** (e.g. the customer replies "SIM", or accepts through a link).
  - The Marketing & Loyalty API (`listaUsuarios`, `resumoUsuario`) answered a 404 HTML page with the store
    token; it needs its own login (email/password) and only lists customers enrolled in Alloy's points
    program. Not a usable source unless Loja Piloto uses that program.
  - `getorders` returned zero orders in every probe (also without filters), so a real customer block can only
    be seen by capturing a webhook delivery unmasked.
- **Prerequisites (build in this order, nothing earlier exists):**
  1. Confirm with Alloy: consent field? meaning of `desliga_notificacoes`? loyalty program active?
  2. A customer record per store: phone only (encrypted), last order, consent + date + source, opt-out. No
     CPF, no address.
  3. WhatsApp Cloud API integration (templates approved by Meta, opt-in required outside the 24h window).
  4. Order history per customer on top of the working Order → Items chain.
- **Rules:** LGPD and Meta policy first; every send checks consent and opt-out at send time; scoped by
  `organizationId` + `storeId` like all data.
- **Impact:** A visible, money-first result for the owner (recovered revenue) — a strong sales demo.

---

## 5. WhatsApp as the main interface: every action goes through the AI (decided 2026-10-14)

**Stage: AGIR. No code yet; depends on the WhatsApp integration itself (see
[whatsapp-quick-query.md](./features/whatsapp-quick-query.md)).**

Most of the day-to-day use will happen on WhatsApp, not on the screens. So every action the screens offer
today must also be reachable by a message ("registra o lote do molho verde, 1.537 g", "conta o ketchup
apimentado: 900 ml", "junta esses dois bacons", "cria o preparo cebola caramelizada").

- **One path, not two.** The AI only **calls the same services** the screens and API routes already use
  (`app/lib/services/`): register purchase, count stock, edit ingredient, register batch, save preparation,
  mark in/out of operation, group a variation, merge. No separate write logic for WhatsApp, so the rules
  (same unit to merge, one-level families, tenant scoping, ledger entry for every balance change) hold on
  both channels.
- **AI proposes, code validates** (the same rule as the ingredient review): the AI turns the message into a
  structured action; names must resolve to ingredients of the store; anything ambiguous becomes a question,
  never a guess.
- **Confirmation before writing.** The reply restates what will change, in the unit people read and with the
  money impact ("Ketchup apimentado: 1.000 → 900 ml. Confirma?"). Reads (stock, cost, margin) need none.
  Irreversible actions (merge, delete) always ask; low-risk ones may be one-tap.
- **Audited like the screens:** `logAuditEvent` with `source: 'whatsapp'`, the sender resolved through
  `Stores.whatsappNumber`.
- **Lessons from building the screens to carry over:** quantities are typed in the unit people say (ml, not
  L; a 150 ml bottle is 150, not 0,15), a recipe line is in the ingredient's own unit (so "cheiro verde em
  gramas" may need a unit conversion first), and every balance edit leaves a ledger row.

---

## 6. Pending-items sentinel: the AI keeps checking what the owner still has to settle (decided 2026-10-14)

**Stage: RECOMMEND → AGIR. Depends on the WhatsApp integration; the signals already exist in the app.**

While building, the most useful thing was a short list of "what is still open". The product should do that
by itself and send it to the owner on WhatsApp, as a **cron** (a platform cron registered in Sistema > Jobs
like `cron.sefaz.auto-sync`, `cron.*`), so nobody has to remember to open a screen. It is *exception driven*:
it says only what needs attention, and says it in R$ when it can.

- **What it collects (deterministic, from the code, not from the AI):**
  - ingredients still "A confirmar" (unreviewed drafts) and pending duplicate suggestions;
  - preparations without a recipe, or without any batch registered (`empty_preparations` is already a
    dashboard attention item), and stock negative on a preparation or ingredient ("entrega pendente?");
  - orders with an incomplete recipe (cost is only a floor), unmapped invoice lines, notes captured as
    preview only, mappings with a suspicious conversion factor;
  - a physical count older than N days, SEFAZ notes waiting.
- **What the AI does:** orders them by money at stake, writes two or three lines in plain language and, for
  each, offers the one-message answer ("Quanto pesa um maço de cheiro verde? Responda só o número"). The
  reply goes through the actions of item 5, so closing a pending item is one message.
- **Cron shape:** one job per store on a schedule (e.g. once a day, outside service hours), the same
  `store × lastSent` bookkeeping as other jobs. It must **not repeat itself**: an item already sent and not
  answered is reminded after a few days, not daily; a dismissed item ("deixa pra lá") is remembered like a
  dismissed duplicate suggestion.
- **WhatsApp constraint:** outside the 24h window only an approved **template** can open the conversation,
  so the daily nudge is a template ("Você tem 4 pendências no Custeio. Quer ver?") and the details are
  free-form once the owner answers (see the window section of
  [whatsapp-quick-query.md](./features/whatsapp-quick-query.md)). Respect the opt-out like any other send.
- **Why it matters:** the quality of cost, stock and purchase recommendations rests on the owner closing
  these gaps ("trust over fake precision"); the sentinel turns that into a habit instead of a chore.

---

## Spike (2026-10-03): AI draft of the ficha técnica — deferred to a second version

Decision: the first version fills the fichas **by hand**. What a spike with Gemini (free tier, structured JSON
output) showed, so it is not lost (`scripts/dev/recipe-draft-spike.ts`, read-only, writes nothing):

- **Works as a draft that speeds things up, not as a finished sheet.** On the one ficha the owner had filled
  (Adão Burger + Fritas) 3 of 4 lines matched exactly (linguiça 150 g, 150 g fries, 1 bun); the 4th (cheddar
  10 g) contradicts the menu text ("queijo prato"), which the draft also surfaced. On other burgers it got the
  bun, the 150 g Angus patty and the fries right, multiplied combos correctly, and put what it did not have
  (caramelized onion, the sauce of choice, the free sodas) in "missing" instead of inventing it.
- **Weak spots**: it guesses the "standard" portions (cheese 20 g, bacon 30 g; the owner uses 10 g of cream
  cheddar) and read a cheddar *prep* as sliced; it trips on the unit of pack-style ingredients ("20 un" of a
  300 g cheese, "10 un" of a lettuce tray) — a cap alone does not catch it, a line-cost-vs-price check would;
  the cheapest model (3.5-flash-lite) was clearly worse than 3.5-flash (7–9 s per product vs 2 s).
- **Free tier is not a basis for production**: `gemini-3.8-flash` answered 503 "high demand" repeatedly,
  `gemini-2.5-flash` is closed to new accounts, and free-tier content may be used by Google to improve its
  products — fine for the lab store's menu, not for a paying client.
- **Size**: ~6–7k tokens per product, so a whole menu is ~0.5M tokens and ~10 minutes at 7 s spacing.
- **Design that survived**: no RAG (the catalog fits in the prompt); the model never writes to the database;
  its answer is a structured list that our code validates (ingredient exists in the store, unit and quantity
  plausible, no duplicates, never over a confirmed recipe) and stores as a **draft** with the source of every
  line (`description` / `standard` / `inferred`); a draft does not debit stock until confirmed.
- **Prerequisite for v2**: the catalog sync does not store the item/complement descriptions yet.
- **It must know where an ingredient lives**: every "+ Fritas" product carries the complement "Fritas Combo"
  (`802`, or empty code), and an order lists it with its own quantity — so the fries portion belongs in the
  *complement's* recipe, not in the product's (the draft put it in the product, which would count it twice and
  get a combo's "Fritas Combo × 3" wrong). The same goes for the free soda ("Refrigerante 200ml", `804`).

