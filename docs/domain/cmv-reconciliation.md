# CMV teórico vs. real, divergência e confiança dos dados

> Registrado em 2026-09-29. **Estado:** o cálculo de custo/margem **por produto** (custo da receita)
> é **IMPLEMENTADO** ([`features/products.md`](../features/products.md)). O CMV **por venda**, o
> consumo teórico vs. real e a divergência são **PLANEJADOS** — dependem de `pos.order.received`, que
> não existe. A mecânica de débito por receita está especificada em
> [`features/stock-and-cmv.md`](../features/stock-and-cmv.md); este documento acrescenta a camada de
> **conferência**.

## Do relatório ao diagnóstico

Não basta dizer "CMV = 32%". A reconciliação tenta dizer **onde** e **quanto**.

```text
vendeu 1.000 X-Bacon · ficha diz 100 kg de carne  (consumo teórico)
compras + estoque + movimentos indicam ≈ 116 kg   (consumo observado)
diferença: 16 kg × R$40/kg médio  ⇒  ≈ R$640
```

> "Existe uma diferença de ≈ 16 kg de carne entre o consumo esperado e o observado, equivalente a
> ≈ R$640."

## Definições

- **Consumo teórico** = vendas × ficha técnica (incluindo adicionais).
- **Consumo observado** = saldo inicial + compras − saldo final (contagem), a partir de
  `StockMovements`/contagens.
- **Divergência** = observado − teórico, por insumo e período, valorada pelo custo médio (`averageCost`).
- **CMV real** = custo dos insumos ao preço do momento da venda (a spec já fixa `Orders.calculatedCost`
  no momento do evento — uma compra posterior não reescreve o passado).

## Saídas explicadas (planejado)

Consumo interno/cortesia e avarias são saídas legítimas que não são venda. Registradas, deixam de
contar como divergência — ver [`non-sale-stock-outflows.md`](./non-sale-stock-outflows.md).

## O que a reconciliação deve detectar

- divergência entre consumo esperado e real, e potencial desperdício;
- insumo inconsistente (compra sem consumo, consumo sem compra);
- **venda de produto sem ficha técnica** (consumo invisível, CMV artificialmente perfeito);
- **estoque negativo**;
- **custo desatualizado** (insumo sem compra recente);
- insumo nunca comprado (CMV perfeito até a primeira NF).

Sempre que possível, **quantificar em R$**.

## Confiança dos dados

Não fingir precisão. Um indicador de confiança (planejado) combinaria:

- % das vendas com ficha técnica;
- % dos insumos mapeados;
- data da última contagem física;
- NF-es importadas / compras atualizadas;
- vendas sincronizadas;
- produtos sem mapeamento.

```text
Confiabilidade da estimativa: 87%
 ✓ 96% das vendas têm ficha técnica
 ✓ compras atualizadas
 ⚠ última contagem física há 18 dias
```

A transparência faz parte da proposta. A divergência e a previsão devem mostrar essa confiança
junto do número.

## O que já apoia isso no código

`StockMovements` (ledger com `purchase` e `adjustment`; `sale` reservado), contagem de estoque
(`/api/raw-ingredients/count`), `RawIngredients.averageCost` e `lastPurchase`, fichas técnicas em
`PartnerProducts`. Falta a ponta de **vendas por item** — ver
[`architecture/current-state.md`](../architecture/current-state.md#lacunas-para-a-nova-visão).
