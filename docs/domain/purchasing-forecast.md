# Previsão de consumo e recomendação de compra

> **Estado: PLANEJADO.** Registrado em 2026-09-29 como direção; **não há forecast, histórico de
> vendas por item nem recomendação de compra no código**. Ver
> [`architecture/current-state.md`](../architecture/current-state.md) para as lacunas concretas.
> Visão: [`product/vision.md`](../product/vision.md).

## Previsão é de ingrediente, não só de venda

O histórico de vendas vira necessidade de insumo pela ficha técnica.

```text
histórico esperado:  sex 70 · sáb 120 · dom 90 · seg 40  = 320 hambúrgueres
ficha:               160 g de carne por hambúrguer
demanda prevista:    320 × 160 g = 51,2 kg

estoque atual 34 kg · segurança 5 kg
necessidade:         51,2 + 5 − 34 = 22,2 kg
fornecedor vende em múltiplos de 5 kg  ⇒  comprar 25 kg
```

## Modelo de previsão (V1: simples e explicável)

Não assumir Machine Learning. Evoluir por camadas, cada uma só se pagar o custo de complexidade:

1. média histórica / média móvel;
2. dia da semana;
3. semana do mês, começo/fim do mês;
4. dias sem operação;
5. feriados, datas comemorativas, promoções, eventos cadastrados;
6. tendência e comportamento recente; sazonalidade;
7. modelos mais sofisticados — só depois.

Prioridade: **previsão útil, explicável e confiável > modelo tecnicamente sofisticado.**

## Recomendação de compra

```text
necessidade de compra =
    demanda prevista até a próxima reposição
  + estoque de segurança
  − estoque disponível
  − compras já programadas
```

Depois aplicar as restrições do fornecedor (embalagem, múltiplo, pedido mínimo, dias de pedido,
lead time — ver [`supplier-lead-time.md`](./supplier-lead-time.md)).

A recomendação responde: **o que** comprar, **quanto**, **quando pedir**, **até quando** esse
estoque deve durar e **por quê**.

## Explicabilidade obrigatória

Nunca só "Comprar 30 kg". Sempre a conta:

```text
Blend bovino
  Estoque atual ................ 24 kg
  Consumo previsto até a entrega 47 kg
  Estoque de segurança .........  4 kg
  Necessidade calculada ........ 27 kg
  Fornecedor vende em múltiplos  5 kg
  Recomendação ................. 30 kg
```

O dono precisa poder perguntar "como chegou nesse número?" (botão "Ver cálculo" / pergunta no
WhatsApp).

## Confiança da estimativa

Ver [`cmv-reconciliation.md`](./cmv-reconciliation.md#confiança-dos-dados): a previsão herda a
confiança dos dados que a alimentam e deve exibi-la.

## Entrega

Resultado consumido principalmente por WhatsApp
([`features/whatsapp-quick-query.md`](../features/whatsapp-quick-query.md)); dashboard para
configurar, investigar e tratar exceções. Exemplo de mensagem-alvo:

```text
📦 Custeio — próxima compra
Próximo recebimento do açougue: terça-feira.
🔴 Blend   — comprar 30 kg
🟡 Bacon   — comprar 8 kg
🟢 Cheddar — estoque suficiente
O blend deve durar até segunda à noite; sem reposição há risco de ruptura antes da entrega de terça.
```

## Como validar

Na Loja Piloto: comparar a recomendação com o consumo real, contar rupturas evitadas e excesso reduzido,
medir o erro médio da previsão. Sem essas métricas a previsão não deve ser vendida como confiável.
