# POS platforms (integration)

## Context

`Stores.provider` records which POS platform the store uses. Each store (each CNPJ) has its **own
subscription** on the chosen platform — Custeio does not have one shared account. That is why
`externalId` and `apiKey` live on the `Store` document itself (not in `SystemSettings`): they are
that specific CNPJ's credentials on its platform, configured under **System → Organizations →
Configure POS integration**.

See the full schema in [`app/models/stores.ts`](../../app/models/stores.ts) and
[Stores](./stores.md).

Full technical mapping of Alloy's routes/authentication/webhooks (the only one already
integrated): [Alloy API](./alloy-api.md).

## Providers in the enum today

| Provider    | Status in Custeio                           | Third-party API/webhook                                                                                                                                                                                                |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alloy`     | **Active** — we have an account and API access | Open API + webhooks, built for third-party integration. High-confidence source.                                                                                                                                        |
| `consumer`  | Coming soon (not integrated)                   | Has a "Partner API", but it is event-oriented and designed for **Consumer to query the partner's API** (a marketplace/delivery order flow) — not confirmed that it exposes a simple way to export sales history to us. |
| `saipos`    | Coming soon (not integrated)                   | Developer portal with API + webhooks, but requires signing up and **homologating** the integration before access is granted.                                                                                           |
| `grandchef` | Coming soon (not integrated)                   | Has API endpoints, but the publicly documented ones are narrow (tax issuance via NotaVarejo, iFood) — we did not find a generic sales-export API.                                                                      |
| `anota_ai`  | Coming soon (not integrated)                   | An integration webhook exists, but it is designed for orders via TOTVS Food Service; activation goes through a support ticket, it is not self-service.                                                                 |

**Practical conclusion**: only Alloy is confirmed as self-service (a public form/API, with no
human approval on their side). The other four probably require becoming a "homologated partner"
of the platform — a commercial process, not just a technical one — before any real integration is
built. The enum already reserves the field for that, but the integration code itself (reading
sales, stock deduction) only exists/will exist for Alloy for now.

These 4 names (Consumer, Saipos, GrandChef, Anota Aí) were chosen by market research (September 2026) as the most relevant food-service players in Brazil after Alloy — it is not a definitive
list, it is the starting point for expansion.

## Alloy already has native "stock control" — confirmed, not just marketing

Investigated in depth in the official help center (`ola.meajuda.cc/delivery-salao/estoque-e-custos`,
2026-09-19) — it is not a superficial module, it has real substance:

- **Recipe with fractional ingredients** — confirmed with a quote: "register the ingredient stock
  in kilograms and, in a product's recipe, put a quantity in grams that will be deducted for each
  product sold." Supports kg/g and L/ml.
- **Low-stock alert over WhatsApp** — confirmed, the same channel Custeio plans (see
  [whatsapp-quick-query.md](./whatsapp-quick-query.md)).
- **NFe (model 55) XML import** to enter stock, with reconciliation of the invoice's product
  against the system's catalog and a conversion factor — the same concept as our
  `SupplierItemMappings`, it already exists there.

**What remains a differentiator, confirmed**: Alloy's NFe import is a **manual file upload by the
owner** ("Select the NF-e XML file") — they download the XML from somewhere themselves and upload
it on the screen; it does not fetch automatically from SEFAZ. That is exactly where direct
capture through `NFeDistribuicaoDFe` (see [sefaz-nfe.md](./sefaz-nfe.md)) wins: zero clicks, zero
manual upload. Alloy's "Average cost field" also seems to be entered manually, not automatically
recalculated as a weighted average cost on every purchase as Custeio plans (see
[stock-and-cmv.md](./stock-and-cmv.md)) — not confirmed for certain, but nothing in the
documentation suggests automatic calculation.

**A real validation question for the pilot**: does the Loja Piloto owner already use this
native Alloy module? If so, do they upload XML manually today (and find it laborious enough to
pay for automation), or do they not use the module at all because it is a chore? The answer
changes where Custeio fits in — "zero touch end to end" is only a strong pitch if the manual
work it replaces is a genuinely felt pain, not a hypothetical one.

## Sources

<!-- cspell:disable -->

- [API Alloy / Alloy Sistema para Food Service](https://www.alloy.al/integracoes/api)
- [Como integrar pedidos ao Consumer por meio de uma API de parceiros?](https://ajuda.programaconsumer.com.br/integracao-api-do-parceiro/)
- [Saipos API Reference](https://saipos-api-logistica.readme.io/reference/introducao)
- [Com quais plataformas a Saipos possui integração?](https://meajuda.saipos.com/hc/pt-br/articles/20211287094548-Com-quais-plataformas-a-Saipos-possui-integra%C3%A7%C3%A3o)
- [GrandChef — Integração NotaVarejo](https://help.grandchef.com.br/online/article/como-integrar-o-grandchef-online-com-o-notavarejo-emissao-fiscal/)
- [Integração Anota Ai - TOTVS Food Service](https://tdn.totvs.com/x/S1EJMQ)
<!-- cspell:enable -->
