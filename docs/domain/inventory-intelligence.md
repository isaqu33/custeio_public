# Cobertura inteligente de estoque

> **Estado: PLANEJADO.** Registrado em 2026-09-29 como direção de produto. Nada aqui está
> implementado; o que existe hoje é o estoque por insumo com `minAlertStock` (limite estático) — ver
> [`features/stock.md`](../features/stock.md). Visão: [`product/vision.md`](../product/vision.md).

## A pergunta

> "Meu estoque atual é suficiente **até a próxima reposição possível**?"

Isso é diferente do estoque mínimo tradicional:

```text
estoque < estoqueMinimo  ⇒  alerta          ← insuficiente
```

O alerta estático ignora a realidade do fornecedor: quando dá para pedir e quando a mercadoria chega.

## Exemplo

Há carne para sábado e domingo. Mas o açougue só recebe pedido na segunda e entrega na terça, e o
restaurante abre na segunda. Ter estoque para o fim de semana **não basta**: a cobertura precisa
alcançar sábado + domingo + segunda + margem de segurança, **até a reposição estar de fato
disponível**.

## Conceitos

- **Horizonte de cobertura:** do agora até o momento em que a próxima reposição fica disponível
  (data do próximo pedido possível + lead time), mais margem.
- **Cobertura atual:** por quanto tempo o estoque disponível sustenta o consumo previsto (em dias/
  turnos e em data estimada de esgotamento).
- **Último momento seguro para pedir:** o alerta deve disparar **antes** dele, não quando o estoque
  já está baixo. Ex.: "se não comprar na segunda, a próxima oportunidade será tarde demais."
- **Estoque de segurança:** margem desejada por insumo (hoje não modelada; `minAlertStock` é o mais
  próximo).
- **Estoque disponível:** saldo atual (`RawIngredients.currentStock`), descontadas compras já
  programadas quando existirem.

## Sinais de diagnóstico do "presente"

Ingredientes críticos, estoque negativo, fichas técnicas incompletas, divergências (ver
[`cmv-reconciliation.md`](./cmv-reconciliation.md)), possíveis perdas.

## Dependências

| Precisa de                              | Onde está / estado                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Saldo confiável por insumo              | IMPLEMENTADO (`RawIngredients`, `StockMovements`, contagem)                         |
| Consumo previsto por insumo             | PLANEJADO — [`purchasing-forecast.md`](./purchasing-forecast.md)                    |
| Ciclo de pedido/entrega do fornecedor   | PLANEJADO — [`supplier-lead-time.md`](./supplier-lead-time.md)                      |
| Dias/horários em que a loja funciona    | PLANEJADO (a `Store` não tem calendário operacional)                                |

## Fora do escopo do primeiro corte

Cobertura por lote/validade, multi-armazém, transferência entre lojas. Começar simples (princípio
"start simple" em [`product/principles.md`](../product/principles.md)).
