# Custeio billing + invoicing the client

How **Custeio bills its own subscription** to clients (not to be confused with step 1 of
`CLAUDE.md`, which is Custeio _reading_ the client's purchase invoices) and how to issue the
service invoice for that charge. `Organizations.asaasCustomerId`/`billingStatus` already reserve
the fields for it, but no integration exists yet.

> Researched on 2026-09-19 from Asaas's public documentation and NFS-e/MEI legislation.

## Decision: Asaas

The `asaasCustomerId` field name (already in `Organizations`, see
[organizations.md](./organizations.md)) suggests this choice had already been made implicitly
before this conversation — we confirmed it makes sense to keep:

- **A simple SMB profile** is exactly our case: recurring monthly charges, no need for payment
  splitting between multiple parties (that is a marketplace thing, not our model) nor for
  heavily contract-customized B2B plans. More advanced tools on those fronts (Iugu for
  split/white-label sub-accounts, Vindi for complex plan modeling) cost more and solve a problem we
  do not have.
- **PIX, boleto and card natively**, settling D+1 (Pix) / D+2 (card) without needing to advance
  receivables — important because the audience (a hamburger-joint owner) probably does not trust
  a recurring credit card as readily as Pix/boleto.
- **Free account, charges only when it receives** — no fixed monthly fee for the tool itself,
  which matches the "low operating cost" goal in `CLAUDE.md`.
- **Solves both problems in one place** (see next section) — automatic NFS-e issuance on every
  paid recurring charge, with no second tool/integration just for the invoice.

## The MEI question: does an invoice have to be issued to the client?

**Yes, no exception.** A MEI selling a service to a **legal entity** (CNPJ) is **required to issue
an invoice**, regardless of the amount — this rule already applies today; it is not a 2026/2027
change (what changes in 2027 is the obligation extending to sales to individuals too, still
optional in that case today). Since Custeio's clients are CNPJs (hamburger joints/snack bars),
the option of simply not issuing an invoice **does not exist** — not issuing when required risks a
fine of up to 75% of the transaction value and, in the extreme, cancellation of the MEI's CNPJ.

- The right type is **NFS-e** (service invoice), not NF-e (that one is for the sale of goods —
  the one we already documented in [sefaz-nfe.md](./sefaz-nfe.md) for the client's _purchase_
  side).
- Since 2023-09-01 there is the **National NFS-e**, a single standard issued through the
  `gov.br/nfse` portal — before that each municipality had its own system/XML, which would have
  been far more painful to integrate. This simplifies the choice of tool: Asaas (and other
  aggregators) already issue against this national standard, with no need to integrate
  municipality by municipality.
- **MEI ceiling**: ~R$81,000/year (~R$6,750/month) in revenue. Not a blocker now, but a real
  growth limit — if Custeio's subscription revenue grows close to it, it has to move from MEI
  to Simples Nacional (ME) before exceeding the ceiling, which changes how it is taxed. Worth a
  reminder/alert of our own (it is not something the product solves; it is management of the
  business itself).

## How automatic issuance works in Asaas

- Configurable per subscription: issue the NFS-e only after payment confirmation, on the due
  date, or within a window before/after — no manual action needed on each charge.
- **R$0.49 per invoice issued** — a direct cost to add to the per-client/month unit economics
  (small, but it exists).
- **Tax reform**: from 2026 new mandatory fields (IBS/CBS) enter the invoices, already covered by
  the National Data Environment — Asaas already signals it is adapting. Custeio does not
  implement this on its own; it is the invoice provider's (Asaas) responsibility to keep it up to
  date — but it is worth monitoring whether it affects the invoice text/config we set up.

## Open / pending decision

- **Are billing and the invoice per `Organization` (Cliente) or per `Store` (Loja)?** This became
  visible now that we crossed this doc with the Cliente/Loja split (see [stores.md](./stores.md)):
  `asaasCustomerId`/`billingStatus` live today in `Organizations`, but the CNPJ (the datum that has
  to go on the NFS-e as the service taker) was moved to `Stores`. A Cliente with 2 stores (2
  CNPJs) — which CNPJ receives the invoice? If Custeio's price scales with the number of
  connected stores (it makes sense, since each store is one more SEFAZ certificate and one more
  Alloy connection to maintain), billing/invoicing should probably move to `Store` too, not stay
  on `Organization`. We have not decided this yet — it is needed before implementing anything real
  in billing.
- **The pricing model itself** (per store? per order-volume tier? a flat plan?) — not discussed in
  this conversation; it is the next step after resolving the question above.
- No Asaas webhook integration (payment confirmation, delinquency) has been designed yet — it is
  what would really feed `billingStatus` (`up_to_date`/`past_due`).

## Sources

<!-- cspell:disable -->

- [Emitir notas fiscais automaticamente para assinaturas — Asaas Docs](https://docs.asaas.com/docs/emitir-notas-fiscais-automaticamente-para-assinaturas)
- [Emitir nota fiscal automaticamente em 2026 — Blog Asaas](https://blog.asaas.com/emitir-nota-fiscal-automaticamente/)
- [Reforma Tributária e mudanças na NFS-e no Asaas](https://blog.asaas.com/release/mudancas-na-nfs-e-no-asaas/)
- [Preços e taxas Asaas](https://www.asaas.com/precos-e-taxas)
- [Nota Fiscal MEI 2026: quando é obrigatória e como emitir — Razonet](https://razonet.com.br/contabilidade-digital/nota-fiscal-mei-em-2026-quando-e-obrigatoria-e-como-emitir)
- [MEI Precisa Emitir Nota Fiscal em 2026? — Transparência Contábil](https://transparenciacontabilgyn.com.br/emissao-nota-fiscal-mei-2026-2027/)
- [Gateways de Pagamento Online no Brasil em 2026 — Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)
<!-- cspell:enable -->
