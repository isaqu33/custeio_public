# Estado atual (código × visão)

> Levantado em **2026-09-29** lendo o código e **atualizado em 2026-10-05** (webhook de pedidos, baixa por ficha, Pedidos, crons em Jobs) (`app/models`, `app/jobs`, `app/lib/services`,
> `app/api`, páginas em `app/(protected)`). Este arquivo é a foto do que **existe**; a direção está em
> [`product/vision.md`](../product/vision.md). Reescreva-o quando o código mudar — quando este
> arquivo e o código divergirem, o código vence.
>
> Legenda: **IMPLEMENTADO** · **EM DESENVOLVIMENTO** · **PLANEJADO**

## Mapa: visão × código

| Etapa      | Capacidade                                                                                                                                                  | Estado                                                                | Onde                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAPTURAR   | Captura de NF-e por upload (XML e DANFE PDF)                                                                                                                | IMPLEMENTADO                                                          | `app/jobs/sefaz-nfe-received.ts`, `app/lib/services/nfe-capture.ts`                                                                                           |
| CAPTURAR   | Rascunho automático de insumo + dedupe por nome                                                                                                             | IMPLEMENTADO                                                          | idem (Tier 1 e 2 de [`sefaz-nfe.md`](../features/sefaz-nfe.md))                                                                                               |
| CAPTURAR   | De/Para fiscal (fornecedor+`cProd` → insumo + fator)                                                                                                        | IMPLEMENTADO                                                          | `app/models/supplier-item-mappings.ts`                                                                                                                        |
| CAPTURAR   | "Buscar na SEFAZ" com fonte **simulada**                                                                                                                    | IMPLEMENTADO (simulado)                                               | `app/lib/sefaz-source.ts`, `nfe-sync.ts`, `SEFAZ_SOURCE`                                                                                                      |
| CAPTURAR   | SEFAZ ao vivo                                                                                                                                               | PLANEJADO                                                             | `live` falha de propósito (custódia do certificado). Consulta real **testada por script** em 06/10                                                            |
| CAPTURAR   | Catálogo do Alloy (`pos.catalog.sync`)                                                                                                                      | IMPLEMENTADO                                                          | `app/jobs/pos-catalog-sync.ts`, `alloy-client.ts`, `alloy-catalog.ts`                                                                                         |
| CAPTURAR   | Venda do Alloy (webhook + `pos.order.received`)                                                                                                             | IMPLEMENTADO (não exposto)                                            | `app/api/v1/webhooks/alloy`, `pos_events`, `services/order-stock.ts`; falta a URL pública no app; a ponte (linha abaixo) recebe por ele                       |
| CAPTURAR   | Ponte do webhook (receptor sempre no ar + cron `bridge.pull`)                                                                                               | IMPLEMENTADO (2026-10-09; falta `BRIDGE_MONGODB_URI` e pedidos reais) | `docs/features/webhook-bridge.md`, `services/bridge-pull.ts`, projeto `custeio-webhook-bridge`                                                                |
| CAPTURAR   | Contagem de estoque                                                                                                                                         | IMPLEMENTADO                                                          | `/api/raw-ingredients/count`                                                                                                                                  |
| ENTENDER   | Estoque por loja, custo médio/real, ledger de movimentos                                                                                                    | IMPLEMENTADO                                                          | `RawIngredients`, `StockMovements`, `stock-movements.ts`                                                                                                      |
| ENTENDER   | Ficha técnica e adicionais, custo e margem por produto                                                                                                      | IMPLEMENTADO                                                          | `PartnerProducts`, `services/products.ts`, `/organization/products`                                                                                           |
| ENTENDER   | Precificação (margem/preço) — _secundária_                                                                                                                  | IMPLEMENTADO (parcial)                                                | página Produtos (custo, margem, export CSV)                                                                                                                   |
| ENTENDER   | Baixa por receita e CMV real por venda                                                                                                                      | IMPLEMENTADO (sem fichas ainda)                                       | `services/order-stock.ts`, `order-consumption.ts`, `product_recipes`; testado em Mongo real                                                                   |
| CONFERIR   | CMV teórico vs. real, divergência em R$                                                                                                                     | PLANEJADO                                                             | [`domain/cmv-reconciliation.md`](../domain/cmv-reconciliation.md)                                                                                             |
| CONFERIR   | Índice de confiança dos dados                                                                                                                               | PLANEJADO                                                             | —                                                                                                                                                             |
| PREVER     | Forecast de consumo, cobertura de estoque                                                                                                                   | PLANEJADO                                                             | [`domain/`](../domain/)                                                                                                                                       |
| RECOMENDAR | Recomendação de compra, lead time de fornecedor                                                                                                             | PLANEJADO                                                             | —                                                                                                                                                             |
| AGIR       | WhatsApp (`whatsapp.message.incoming`, alertas)                                                                                                             | PLANEJADO                                                             | só `Stores.whatsappNumber` e a spec                                                                                                                           |
| AGIR       | Dashboard: 4 números + "Precisa da sua atenção" (exceções)                                                                                                  | IMPLEMENTADO (2026-10-10)                                             | `services/dashboard.ts`, `lib/attention.ts`, [`dashboard.md`](../features/dashboard.md); valor em estoque é estimativa até haver contagem                     |
| Plataforma | Multi-tenant Cliente→Loja, usuários, auditoria, jobs, CSV, i18n                                                                                             | IMPLEMENTADO                                                          | `Organizations`, `Stores`, `Users`, `AuditEvents`, `Jobs`                                                                                                     |
| CAPTURAR   | Compra digitada ("Registrar compra") para nota não capturável                                                                                               | IMPLEMENTADO                                                          | `services/manual-purchase.ts`, `components/register-purchase-dialog.tsx`                                                                                      |
| CAPTURAR   | Eventos do PDV (histórico do webhook, JSON recebido)                                                                                                        | IMPLEMENTADO                                                          | `pos_events`, `/system/pos-events`                                                                                                                            |
| ENTENDER   | Ficha técnica por código do PDV (produto e complemento)                                                                                                     | IMPLEMENTADO                                                          | `product_recipes`, `services/shared-recipes.ts`, `/organization/modifiers`                                                                                    |
| ENTENDER   | Pedidos: situação do estoque, ficha incompleta, reprocessar                                                                                                 | IMPLEMENTADO                                                          | `services/orders.ts`, `/organization/orders`, job `pos.orders.reprocess`                                                                                      |
| Plataforma | Execuções dos crons registradas como jobs (`cron.*`)                                                                                                        | IMPLEMENTADO                                                          | `services/cron-job-records.ts`, Sistema > Jobs                                                                                                                |
| CAPTURAR   | Notas guardadas (prévia `resNFe` ou completa, com o XML) e tela Notas com download                                                                          | IMPLEMENTADO                                                          | `nfe_documents`, `services/nfe-documents.ts`, `/organization/invoices`, `GET /api/nfe-documents/xml`                                                          |
| CAPTURAR   | Ciência da Operação (evento 210210) — **só por script, não no app**                                                                                         | PARCIAL (dev)                                                         | `scripts/dev/sefaz-ciencia.ts`; envio automático PLANEJADO                                                                                                    |
| ENTENDER   | Copiar ficha de outro produto no editor de ficha                                                                                                            | IMPLEMENTADO                                                          | `getRecipeCopySourcesForStore`, `components/product-recipe-dialog.tsx`                                                                                        |
| ENTENDER   | Juntar insumos (De/Para, histórico e fichas vão para um insumo-base) e custo pela última compra (`costBasis`)                                               | IMPLEMENTADO                                                          | `services/ingredient-merge.ts`, `POST /api/raw-ingredients/merge`, `components/ingredient-merge-dialog.tsx`                                                   |
| ENTENDER   | Preparos: o que a cozinha faz (receita, rendimento, lote) numa página própria; a lista de Insumos mostra só o que é comprado                                | IMPLEMENTADO                                                          | `/organization/preparations`, `components/preparations-view.tsx`, filtro `preparations` em `services/raw-ingredients.ts`                                      |
| ENTENDER   | Consumo interno e avarias: saída de estoque sem venda, ao custo médio, com motivo (e pessoa no consumo interno), total por pessoa/mês                       | IMPLEMENTADO                                                          | `services/internal-use.ts`, `/organization/internal-use`, `docs/domain/non-sale-stock-outflows.md`                                                            |
| ENTENDER   | Vendas: histórico por dia, produto e canal (pedidos aceitos), ticket médio, margem só com fichas completas e média por dia da semana — não depende de ficha | IMPLEMENTADO                                                          | `lib/sales-history.ts`, `services/sales-history.ts`, `/organization/sales`                                                                                    |
| ENTENDER   | Preços de compra: variação de preço com o mesmo fornecedor (R$ a mais pago na última compra) e comparação entre fornecedores; ignora notas canceladas       | IMPLEMENTADO                                                          | `lib/price-report.ts`, `services/price-report.ts`, `/organization/prices`                                                                                     |
| ENTENDER   | Apelidos, códigos de barras (EAN) e embalagem de compra no insumo; busca e pickers os usam; juntar insumos os preserva                                      | IMPLEMENTADO (dados ainda não preenchidos)                            | `lib/ingredient-identity.ts`, `components/raw-ingredient-form-dialog.tsx`                                                                                     |
| CAPTURAR   | Preparo por lote: receita e rendimento do lote em um insumo (Molho da Casa) e "Registrar lote" (movimentação `production`)                                  | IMPLEMENTADO (sem receitas cadastradas)                               | `services/preparations.ts`, `POST /api/raw-ingredients/preparation` e `/batch`, `components/ingredient-preparation-dialog.tsx`, `ingredient-batch-dialog.tsx` |
| CONFERIR   | Aviso de possível crédito em dobro: compra digitada × NF-e capturada (±7 dias, ±15% da quantidade); o dono desfaz a manual ou mantém as duas                | IMPLEMENTADO                                                          | `services/manual-overlaps.ts`, `manual-overlap-resolve.ts`, `POST /api/nfe-documents/overlap`, tela Notas                                                     |
| CONFERIR   | Dica "Entrega pendente?" em saldo negativo quando há prévia recente de um fornecedor do insumo (só aviso; não mexe no estoque)                              | IMPLEMENTADO                                                          | `services/pending-deliveries.ts`, tela Estoque                                                                                                                |
| Plataforma | Billing (Asaas), e-mail                                                                                                                                     | PLANEJADO                                                             | só campos/specs reservados                                                                                                                                    |

Jobs registrados hoje (`app/jobs/registry.ts`): `users.export.csv`, `organizations.export.csv`,
`sefaz.nfe.received`, `pos.catalog.sync`, `pos.order.received`, `pos.orders.reprocess`,
`nfe.xml.export` (registro de cada download de XML). **Não existe**
`whatsapp.message.incoming`.

## Divergências encontradas entre documentação e código

1. **[`architecture/README.md`](./README.md)** diz que "não existe nenhum dos quatro jobs de domínio,
   nenhum cliente Alloy/SEFAZ" e cita "cinco models". Está desatualizado: `pos.catalog.sync` e
   `sefaz.nfe.received` existem, há cliente Alloy e há 7 models de domínio (`Orders`, `RawIngredients`,
   `PartnerProducts`, `SupplierItemMappings`, `ProcessedInvoices`, `StockMovements`, `SefazRequests`).
   O diagrama `architecture.html` (páginas 3 e 4) ainda marca esses dois jobs como `planned`.
2. **[`features/stock-and-cmv.md`](../features/stock-and-cmv.md)** afirma que "nenhum dos dois jobs foi
   implementado". Metade (crédito por compra) já roda; falta a metade que debita por venda.
3. **[`README.md`](../../README.md)** (raiz) descrevia leitura de NF-e como "em construção"; hoje a
   captura por upload funciona (só a SEFAZ ao vivo falta).
4. **[`CLAUDE.md`](../../CLAUDE.md)** listava os 4 jobs como "papéis" sem distinguir os que existem.
   Atualizado nesta mesma mudança.
5. **Nomes herdados:** banco/usuário Mongo `kairosflow`.

## Lacunas para a nova visão

**Resolvido em 2026-10-02** (era a maior parte desta lista): `Orders` guarda itens, complementos, hora do
evento e canal; `StockMovements.type='sale'` é gravado, idempotente por pedido, ingrediente e revisão; o
webhook do Alloy existe em `/api/v1/webhooks/alloy` (prefixo classificado como ingestão); o consumo está
normalizado no formato do Custeio, não no do Alloy.

Ainda faltam:

- **Dados**: fichas técnicas preenchidas (hoje todos os produtos da Loja Piloto estão "Sem ficha"), URL pública
  para o webhook, insumos que não existem (queijo prato, preparos da casa) e unidades erradas em itens de
  peso vindos das notas (alface, calabresa em `un`).
- **Sem agregado diário de consumo/vendas.** Previsão por dia da semana pede série temporal barata de
  consultar (por loja, por insumo, por dia) — decidir entre agregar na escrita ou por consulta.
- **Sem entidade de fornecedor nem ciclo de pedido.** Fornecedor é só CNPJ/nome em três lugares
  ([`supplier-lead-time.md`](../domain/supplier-lead-time.md)).
- **Sem estoque de segurança nem cobertura.** Só `minAlertStock` estático.
- **Sem calendário operacional da loja** (dias/horários de funcionamento), nem feriados/eventos.
- **Sem recomendação/explicação persistida.** Para "ver cálculo" e para medir a Loja Piloto, as
  recomendações e as entradas do cálculo precisarão ser gravadas (ou reproduzíveis).
- **Consumo interno/cortesia e avarias**: registráveis desde 2026-10-10 (por insumo; por produto vendável e a avaria no recebimento ligada à NF-e ainda não)
  ([`non-sale-stock-outflows.md`](../domain/non-sale-stock-outflows.md)).
- **Observações livres do pedido** que trocam ingrediente ("TROCAR POR -> queijo prato") não são
  modeláveis: o consumo esperado não as vê.

## Referências

[Jobs](../features/jobs.md) · [Stock](../features/stock.md) · [Products](../features/products.md) ·
[SEFAZ NFe](../features/sefaz-nfe.md) · [Alloy API](../features/alloy-api.md) ·
[Stock and real CMV](../features/stock-and-cmv.md) · [POS providers](../features/pos-providers.md)
