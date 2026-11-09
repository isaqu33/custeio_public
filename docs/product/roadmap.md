# Roadmap

> Registrado em 2026-09-29 como **direção**, não como requisitos rígidos. Ordem aproximada por
> prioridade; cada etapa depende de dados confiáveis da anterior. O estado marcado abaixo foi
> conferido contra o código nesta data — ver
> [`architecture/current-state.md`](../architecture/current-state.md).
>
> Legenda: **IMPLEMENTADO** · **EM DESENVOLVIMENTO** · **PLANEJADO**

## P0 — Fundamento operacional

```text
PDV → venda → produto → ficha técnica → ingredientes → baixa/consumo → custo real da venda
```

Sem vendas e consumo confiáveis, o resto fica comprometido. Integração inicial: Alloy.

| Item                                                          | Estado                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sincronizar cardápio do Alloy (`pos.catalog.sync`)            | IMPLEMENTADO                                                           |
| Ficha técnica e adicionais (manual) + custo e margem por item | IMPLEMENTADO (por código do PDV; ainda sem fichas na Loja Piloto)      |
| Estoque por loja, movimentos, contagem, custo médio/real      | IMPLEMENTADO                                                           |
| Captura de NF-e por XML/PDF, De/Para, rascunho de insumo      | IMPLEMENTADO                                                           |
| SEFAZ ao vivo (`SEFAZ_SOURCE=live`)                           | PLANEJADO (hoje só fonte simulada; custódia do certificado indefinida) |
| Receber venda do Alloy (webhook + `pos.order.received`)       | IMPLEMENTADO (payload validado com pedidos reais; falta URL pública)   |
| Baixa por receita e CMV real por venda                        | IMPLEMENTADO (testado em Mongo real; depende das fichas)               |
| Registrar compra manual (NFC-e / recibo)                      | IMPLEMENTADO                                                           |
| Pedidos com ficha incompleta + reprocessar                    | IMPLEMENTADO                                                           |

## Atualização (2026-10-10)

**Construído:** a **ponte do webhook** (receptor sempre no ar na Vercel + Atlas, cron `bridge.pull`; ver
[`features/webhook-bridge.md`](../features/webhook-bridge.md)), já captando pedidos reais (#1633–#1642) com
custo e margem; a aba **Erros da ponte** (evento com erro em quarentena, eventos sem loja, recusas); o
**Consumo interno** (`/organization/internal-use`, ver
[`domain/non-sale-stock-outflows.md`](../domain/non-sale-stock-outflows.md)). **Dados (no banco):** fichas das
4 Cocas, receita da Maionese Defumada (rendimento ainda estimado) e o insumo Fumaça líquida; mostarda
convertida para gramas.

**Decisão:** **foto de nota (NFC-e) e áudio ficam para a fase do WhatsApp**, não para uma tela de upload no app
([`features/receipt-capture-whatsapp.md`](../features/receipt-capture-whatsapp.md)). Até lá, "Registrar compra".

**Pendente:** receitas e rendimento dos molhos (Molho da Casa, Molho Verde), registrar os lotes, juntar insumos
duplicados, fichas do Davi / complementos 807–810 / saquinho, trocar a Chave de teste do webhook.

## Atualização (2026-10-08)

**Dados (no banco, não no código):** 47 fichas gravadas com os pesos da loja (lanches por código do PDV;
"+ Fritas" usa a mesma ficha; complementos de molho, fritas, queijos, bacon, blends e brinde; combos e
promoções sem código por nome). Insumos-base `Bacon`, `Tomate`, `Cebola roxa` e `Alface` criados (alface com
custo estimado). A ficha do Adão (513) perdeu a batata, que fica no complemento 802. **Ficaram de fora:** Davi e
complementos 807–810 (faltam gramas de calabresa, geleia e ketchup picante), o saquinho da fritas (custo do
insumo parece o preço da caixa) e as receitas dos preparos.

**Construído no código:** Juntar insumos + custo "última compra"; preparo por lote ("Registrar lote");
aviso de possível crédito em dobro (compra digitada × NF-e) na tela Notas; dica "Entrega pendente?" em saldo
negativo. Detalhe em [`architecture/current-state.md`](../architecture/current-state.md).

**Próximo, na ordem:** (1) usar "Juntar insumos" nos 3 bacons, 3 tomates, 2 cebolas roxas, 2 batatas McCain e
alfaces; (2) cadastrar a receita e o rendimento dos preparos e registrar o primeiro lote; (3) URL pública do
webhook; (4) fichas do Davi e do saquinho; (5) Ciência da Maria Aparecida (R$ 151,90, só prévia) quando fizer
sentido. A OESA de 06/10 já foi capturada por inteiro. **No painel do Alloy (não há API para isso):** apagar o
webhook "Teste Custeio", trocar os códigos de Molho Verde/Maionese Defumada do "Combo - 04 Sansão" e corrigir o
cheddar do Ester Burguer (219).

## Onde paramos (2026-10-06)

**Construído e no `main`** (commits `d3844b6` e, de 06/10, `77d2bf0`, `7cad485`, `dc6c522`): webhook de
pedidos do Alloy, Eventos do PDV, pedidos com itens e complementos, baixa de estoque por ficha, fichas por
código do PDV, telas Complementos e Pedidos, Registrar compra, crons em Jobs — e, desde 06/10:

- **Tela Notas** (`/organization/invoices`): toda NF-e que temos, como **só prévia** (`resNFe`, sem itens,
  nada entrou no estoque) ou **completa**, com situação (capturada, cancelada…), busca, filtros e
  **download do XML** (cada download vira um job `nfe.xml.export` em Sistema > Jobs). Coleção nova
  `nfe_documents`; o XML, que antes era descartado, agora é guardado (upload e sync SEFAZ). O sync também
  guarda as prévias. `scripts/dev/backfill-nfe-documents.ts` preencheu as 63 notas antigas (XML vindo de
  `~/Documents/notas_testes`) e 1 prévia.
- **Copiar ficha de outro produto** no editor de ficha (Produtos): o X e o "X + Fritas" partilham a ficha.
- **Estoque ordenado pelo mais recente** (`createdAt`), não por nome.
- **Primeira consulta real à SEFAZ** e **primeira Ciência da Operação** (detalhes em
  [`features/sefaz-nfe.md`](../features/sefaz-nfe.md)): o app continua com `SEFAZ_SOURCE=simulated`; a
  consulta real foi por script (`scripts/dev/sefaz-dist-nsu.ts`) e a ciência por
  `scripts/dev/sefaz-ciencia.ts`. A Ciência liberou o XML completo da OESA de 06/10 em minutos.

**Dados cadastrados em 06/10 (no banco, não no código):** insumos `queijo prato`, `cebola caramelizada`,
`Molho da Casa`, `Molho Verde`, `Maionese Defumada` e `Ketchup apimentado` (unidade `g`, saldo 0, **custo
estimado por mim — a Loja Piloto precisa conferir**: R$ 50 / 20 / 17 / 19 / 22 / 9 por kg). A geleia de pimenta e o
"Refri 200ml (brinde)" foram criados à mão pelo dono. Fichas **vazias** ("não consome") salvas nos
complementos 573, 574, 575 (ponto da carne) e 553 (Sem molho). 24 insumos que não são de cozinha (papel
higiênico, toalha, sabão, fita, freezer…) tiveram o tipo corrigido de `food`. Ver o checklist da loja em
`~/Downloads/custeio-checklist-loja.pdf` (fora do repositório).

**O que impede de rodar com vendas reais** (nesta ordem):

- [x] Reiniciar o worker (feito em 06/10; reiniciar de novo sempre que o código dos jobs mudar).
- [ ] **Buscar na SEFAZ** de novo (a trava de 60 min liberou às 17:06) para capturar a OESA de 06/10 completa
      (NSU 325, cheddar 11,35 kg + batata 37,5 kg) e registrar a prévia da Maria Aparecida (NSU 324, R$ 151,90).
      Os arquivos já estão em `~/Documents/notas_testes`.
- [ ] URL pública para o webhook (túnel ou deploy) e webhook novo no Alloy com a chave da loja
      (`scripts/dev/set-store-webhook.ts`). **Apagar** no painel do Alloy o webhook "Teste Custeio" (envia
      pedidos reais com dados de clientes a um webhook.site público). Ligar cedo vale a pena: pedido baixado
      sem ficha pode ser reprocessado depois, então cada dia ligado é histórico guardado.
- [ ] **Na loja** (checklist em PDF): receita real e rendimento dos 6 preparos + queijo prato; gramas por porção
      de cada item; contar o saldo do Angus 100 g (75 ou 25?); os R$ 87,50 do açougue; pedir NF-e ao açougue.
- [ ] Unidades de itens de peso (alface, calabresa, mussarela, maioneses/catchups em sachê ou pet estão em
      `un`) — precisa do peso por unidade. A "Maionese Hellmanns Bag 2,8kg" está com custo ~R$ 3,55/kg (as
      outras ~R$ 20/kg): conversão errada na entrada da nota.
- [ ] Escolher **um insumo por função** (3 bacons, 7 maioneses, 5 catchups, 3 batatas). Hoje o app **não tem
      como juntar insumos** (redirecionar De/Para, somar saldo e custo médio): sem isso, escolhe-se um por
      função nas fichas e os outros ficam com saldo parado.
- [ ] Fichas dos **complementos** (28 faltam; os que mais pesam: Fritas Combo 802, Angus 100 g 806, Refri 804,
      Guaraná 1,5 L 814, molhos 192/193/516/518, queijo prato 812) e dos **lanches** (base primeiro; use
      "Copiar ficha" para o "+ Fritas"). Fritas e refri grátis ficam no **complemento**, nunca no lanche.
- [ ] Corrigir no Alloy: "Combo - 04 Sansão" tem Molho Verde `516` e Maionese Defumada `518` trocados; o
      Ester Burguer diz cheddar e o "Ester + Fritas" diz queijo prato; ficha do Adão (513) tem batata que deve
      ir para o complemento 802.

**Casos de uso levantados em 06/10 (não construídos)** — a nota é emitida no dia da entrega:

1. Entre a entrega e a nota o estoque fica abaixo do real → **estoque negativo falso** (contamina
   reconciliação e cobertura).
2. **Risco de crédito em dobro**: "Registrar compra" na entrega + nota que chega depois pela SEFAZ.
   `manual-purchase.ts` só dedupe por `requestId`; faltaria casar compra manual com nota (fornecedor, valor,
   data). É o caso mais perigoso para a confiança dos dados.
3. O resumo (`resNFe`) já serve de **aviso** ("chegou compra de R$ X da OESA, itens pendentes") e, no futuro,
   de "compra já programada" para a cobertura.
4. Compras sem nota para CNPJ (NFC-e, recibo, açougue) nunca aparecem na SEFAZ.
5. **Ciência automática** (ao ver um resumo novo, enviar a ciência): desenho em `features/sefaz-nfe.md`; só
   depois das fichas e do webhook. Hoje a ciência é manual, uma nota por vez, com aprovação explícita.

**Decisões em aberto**

- Os R$ 87,50 de diferença na compra do açougue (linhas somam R$ 912,50; cupom diz R$ 1.000,00).
- Os 25 Angus 100 g da compra entraram por cima dos 50 que já existiam (saldo 75): manter ou ajustar para 25?
- Perguntar ao contador se ele já registra a Ciência automaticamente (a OESA de 06/10 ficou ~9 h só em resumo,
  então para ela ninguém registrava; as outras 55 notas já vinham completas por motivo não esclarecido).
- Funcionalidade "juntar insumos" (merge) — necessária para o item "um insumo por função".
- Rascunho de ficha por IA: **adiado para a v2** (ver `upcomingImplementations.md`).

**Próximos passos naturais depois disso**: consumo esperado agregado por dia, reconciliação (P1A), consumo
interno/cortesia e avarias, WhatsApp (AGIR).

## P1 — Reconciliação

Comparar consumo esperado (vendas × ficha) com o movimento/estoque real; detectar divergência,
desperdício potencial, insumo inconsistente, venda sem ficha, estoque negativo, custo desatualizado;
quantificar em R$. Detalhe em [`domain/cmv-reconciliation.md`](../domain/cmv-reconciliation.md).

Estado: **PLANEJADO** (depende do P0 de vendas). Já existem as peças de contagem e ledger de estoque.

## P1 — Cobertura e previsão de compra

Consumo histórico, previsão por dia da semana e por insumo, cobertura atual, próxima oportunidade de
pedido, próxima entrega, lead time, estoque de segurança e recomendação de compra. Detalhe em
[`domain/inventory-intelligence.md`](../domain/inventory-intelligence.md),
[`domain/purchasing-forecast.md`](../domain/purchasing-forecast.md) e
[`domain/supplier-lead-time.md`](../domain/supplier-lead-time.md).

Estado: **PLANEJADO**. Pode evoluir em paralelo à reconciliação assim que a base de vendas/consumo
estiver confiável. Hoje só existe `minAlertStock`, um limite estático por insumo.

## P1/P2 — WhatsApp

Alertas relevantes, compra recomendada, risco de ruptura, divergências importantes e consultas
rápidas ("quanto custa meu X-Bacon?", "o que preciso comprar amanhã?", "por que 30 kg?"). API oficial
da Meta. Spec em [`features/whatsapp-quick-query.md`](../features/whatsapp-quick-query.md).

Estado: **PLANEJADO** (só o campo `Stores.whatsappNumber` e a spec existem).

## P2 — Expansão de PDVs

Consumer, Saipos, GrandChef, Anota AI. Só depois de validar a fundo com a Alloy. Estado: **PLANEJADO**.

## Já existente e fora da ordem acima (plataforma)

Multi-tenant Cliente → Loja, usuários e acesso de sistema, auditoria, console de jobs (Bull),
exportações CSV, dashboard (placeholder com "Em breve"), i18n pt-BR/en-US. **IMPLEMENTADO**.
Cobrança (Asaas) e e-mail: só campos/specs reservados, **PLANEJADO**.

## Ideias de IA já desenhadas (pós-MVP)

[`upcomingImplementations.md`](../upcomingImplementations.md): mapeamento automático de insumos por
IA, auditor de compra/margem (NF-e sentinela) e fechamento diário. Encaixam-se em CAPTURAR
(onboarding), CONFERIR/AGIR e AGIR respectivamente — não são pré-requisito da previsão.

## Como medir (Loja Piloto como laboratório)

Ver [`vision.md`](./vision.md#loja-piloto-o-laboratório): erro de previsão, rupturas evitadas,
excesso reduzido, R$ de divergência encontrado. **PLANEJADO** — nenhuma métrica é coletada hoje.
