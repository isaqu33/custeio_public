# Before the first real paying client

A consolidation of what came up in conversation while planning the launch — it is not a product
feature, it is a checklist for whoever is putting the first product live alone. Review it before
moving from the controlled pilot to real paying clients.

> Written on 2026-09-19. Nothing here has been resolved yet — it is the record of what needs a
> decision or action before launch, not a plan already executed.

## Operational readiness (technical, already investigated)

- [ ] **Backup**: prove the restore against the current `custeio` database at least once — the
      restore has not been proven against the current schema. See [backup.md](./backup.md).
- [ ] **Stopped worker/queue alert**: today it **does not exist**. Without it, a dead worker is only discovered
      when a client complains. It has to exist before the domain jobs (`pos.order.received`,
      `sefaz.nfe.received`, `whatsapp.message.incoming`) run with a real client. See
      [alerting.md](./alerting.md).
- [ ] **Data retention**: no policy defined for Custeio's real data — in particular, what to do
      with the client's A1 certificate when they cancel (delete it, not "keep for safety").
- [ ] **Custody of the SEFAZ certificate**: the direction of Blob (file) + Key Vault (password)
      discussed in [sefaz-nfe.md](../features/sefaz-nfe.md) has not been implemented yet — today the
      test certificate sits loose in the developer's `~/Downloads`, which is acceptable in dev but
      cannot be the state when a second real client comes in.

## Legal / LGPD

- [ ] **A privacy policy** of Custeio's own — the product holds a third party's sensitive
      data: not just name/WhatsApp, but recipes, margin and the client's CNPJ digital certificate. It
      needs a declared legal basis to process each type of data.
- [ ] **What to do with the data when a client cancels** — it crosses with the retention item
      above, but it is also a legal obligation (LGPD's right to erasure), not just a technical
      decision.
- [ ] **Terms of Use / Service agreement** — in particular a liability clause on the custody of
      the digital certificate: if Custeio holds the key that signs tax documents on the client's
      behalf and something goes wrong, the contract has to make clear each side's limits of
      liability.
- [ ] **Professional liability / cyber insurance** — it does not block a pilot with one or two
      clients, but it is a real risk that grows with the number of certificates held; worth getting a
      quote before scaling.

## Business

- [ ] **The MEI revenue ceiling** (~R$81,000/year) — see [billing.md](../features/billing.md). Not
      urgent now, but a real growth limit to monitor.
- [ ] **Unit economics per client** — add up the variable costs already identified before fixing
      the plan's price: a WhatsApp message (~R$0.03–0.05 each from 2026-10-01, see
      [whatsapp-quick-query.md](../features/whatsapp-quick-query.md)), an NFS-e issued (R$0.49 on
      Asaas, see [billing.md](../features/billing.md)), Asaas's fee per charge received. None of them
      is expensive alone, but together they define the real margin of a "low-ticket" plan.
- [ ] **Where billing/invoicing lives** (`Organization` vs `Store`) — a pending decision recorded
      in [billing.md](../features/billing.md), it affects the pricing model.

## Support and operations as a solo founder

- [ ] **A support channel agreed with the client** — even an informal one (WhatsApp, email), with
      a response-time expectation you can meet alone. Promising little and delivering is better than
      creating an expectation that does not hold up.
- [ ] **Treat the first client (Loja Piloto) as an explicit pilot** — closer follow-up, an
      agreed expectation of ongoing adjustment, before opening to more clients without that
      follow-up.
