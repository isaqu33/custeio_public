# Visão do produto

> Registrada em 2026-09-29. Este documento é a fonte de verdade sobre **visão e direção
> estratégica**. O **código** é a fonte de verdade sobre o que está implementado — o estado real
> está em [`architecture/current-state.md`](../architecture/current-state.md) e o roadmap em
> [`roadmap.md`](./roadmap.md). Nada aqui deve ser lido como funcionalidade existente.
>
> É uma visão em evolução: será ajustada conforme o Custeio for validado em operações reais.

## O que é o Custeio

**Custeio é uma camada inteligente de custos, estoque e compras para pequenos negócios de
alimentação, integrada ao PDV que o estabelecimento já utiliza.**

> O PDV registra a operação. O Custeio entende, confere e antecipa decisões.

Não é ERP, não é PDV e não é apenas um controle de estoque.

O princípio central para toda decisão futura:

> **O Custeio não existe para registrar mais dados. Ele existe para transformar os dados que o
> restaurante já gera em decisões melhores sobre custos, perdas, estoque e compras.**

## A essência

```text
ENTENDER CUSTOS
+ RECONCILIAR OPERAÇÃO
+ IDENTIFICAR PERDAS
+ PREVER NECESSIDADES
+ RECOMENDAR COMPRAS
```

O Custeio cruza compras, notas fiscais, custo dos insumos, estoque, vendas, fichas técnicas,
consumo teórico e real, histórico, fornecedores e prazos de reposição. Com isso deve responder:

1. Quanto realmente custa cada produto vendido?
2. Quanto deveria ter sido consumido?
3. Quanto aparentemente foi consumido de verdade?
4. Há divergência entre consumo esperado e estoque real — e quanto isso vale em R$?
5. Onde o estabelecimento está perdendo dinheiro?
6. Quanto tempo o estoque atual deve durar?
7. Ele é suficiente até a próxima reposição possível?
8. Quando fazer o próximo pedido, e quanto comprar de cada insumo?

## Três tempos

| Tempo    | Pergunta                    | O que entra                                                                                            |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Passado  | **Entender** o que houve    | compras, vendas, consumo, custos, CMV, divergências, desperdícios                                      |
| Presente | **Diagnosticar** como está  | estoque, custo atual, margem, cobertura, insumos críticos, estoque negativo, fichas incompletas, perdas |
| Futuro   | **Antecipar** o que vem     | demanda esperada, consumo por insumo, quando o estoque acaba, risco de ruptura, quando e quanto comprar |

> O Custeio entende o passado, explica o presente e ajuda a preparar a próxima compra.

## Fluxo conceitual

```text
                 COMPRAS
                    │
                    ↓
                 ESTOQUE
                    │
                    ↓
PDV → VENDAS → CUSTEIO ← FICHAS TÉCNICAS
                    │
          ┌─────────┼──────────┐
          ↓         ↓          ↓
       CMV REAL  DIVERGÊNCIAS HISTÓRICO
                                │
                                ↓
                            PREVISÃO
                                ↓
                     COBERTURA DE ESTOQUE
                                ↓
                      PRÓXIMA REPOSIÇÃO
                                ↓
                    RECOMENDAÇÃO DE COMPRA
                                ↓
                            WHATSAPP
```

## Não somos um ERP

O Custeio **não substitui** Alloy, Saipos, Consumer, GrandChef, Anota AI ou outros PDVs/ERPs. Ele
funciona **sobre** eles. O PDV segue responsável pela operação diária; o Custeio é a camada de
inteligência.

- A primeira integração é a Alloy, mas o Custeio **não pode ficar conceitualmente dependente dela**
  (o campo `Stores.provider` e [`features/pos-providers.md`](../features/pos-providers.md) já
  reservam esse espaço).
- Expansão futura: Consumer, Saipos, GrandChef, Anota AI e outros — só depois de validar a fundo com
  a Alloy.

> Seu PDV vende. O Custeio confere.
> Seu PDV registra. O Custeio entende o que aconteceu e antecipa o que você vai precisar.

### O que não devemos virar

Salvo necessidade estratégica comprovada, **não priorizar**: CRM, fidelidade, delivery próprio,
emissão fiscal completa, financeiro completo, folha/RH, contas a pagar/receber genéricas, cardápio
digital, gestão de mesas, frente de caixa, ou dezenas de dashboards sem ação clara.

Teste para qualquer feature nova:

> Isso melhora nossa capacidade de entender custos, encontrar perdas, prever necessidade ou
> recomendar uma ação? Se não, provavelmente não é prioridade.

## O que já existia continua existindo

Estoque, ingredientes, custo médio, estoque mínimo, fichas técnicas, importação de NF-e (XML, PDF/
DANFE, SEFAZ), De/Para fiscal, fornecedores, histórico de compras, contagem, exportações, CMV,
margem, **precificação**, multiempresa/multiloja, usuários, suporte/admin, logs, jobs, auditoria,
billing e integrações continuam fazendo parte do produto quando fizerem sentido.

O que muda é a **hierarquia**. Antes, CMV, precificação, estoque e importação de compras podiam
parecer o produto. Agora são **fundamentos que alimentam a inteligência**:

```text
DADOS OPERACIONAIS → ENTENDIMENTO → RECONCILIAÇÃO → DIAGNÓSTICO → PREVISÃO → AÇÃO
```

**Precificação continua no Custeio**, mas é uma capacidade **secundária/complementar** — não é a
essência nem o posicionamento principal.

## Cliente inicial (ICP)

Pequeno negócio de alimentação. Ordem de prioridade: **hamburguerias, pizzarias, marmitarias,
lanchonetes.**

Perfil mais interessante: uma unidade; dono próximo da operação; já usa PDV; volume em que o
controle manual começa a falhar; trabalha com fichas técnicas ou consegue estruturá-las; não sabe
exatamente onde perde margem; compra por experiência/intuição; não quer implantar outro ERP.

Feedback de primeira mão que reforça o perfil: quem opera o Alloy no dia a dia não usa o estoque do
próprio Alloy (lança nota manualmente, não tem custo médio por lanche) — o espaço que o Custeio ocupa.

## Loja Piloto: o laboratório

O Custeio é validado primeiro numa operação real, a **Loja Piloto**, para testar integração de
vendas, fichas técnicas, consumo, CMV, divergências, previsão, cobertura, recomendação de compra,
lead time de fornecedores e alertas.

Métricas que queremos medir (planejado — nenhuma é medida hoje):

- erro médio das previsões;
- recomendação de compra vs. consumo real;
- rupturas evitadas;
- redução de excesso de estoque;
- R$ de divergências identificadas e R$ potencialmente economizados;
- insumos/produtos com maior inconsistência.

Pode virar estudo de caso real.

## Onde está o moat

Nenhuma feature isolada é defensável: CMV, ficha técnica, estoque, XML, estoque mínimo, previsão de
vendas, lista de compras e WhatsApp podem ser copiados. O diferencial é a **combinação**:

```text
integração automática + compras + vendas + ficha técnica + estoque + reconciliação
+ divergências + impacto financeiro + previsão + lead time + recomendação de compra
+ explicabilidade + entrega proativa
```

…e a qualidade dos dados acumulados ao longo do tempo.

Ver também: [`positioning.md`](./positioning.md) · [`principles.md`](./principles.md) ·
[`roadmap.md`](./roadmap.md) · [`market-research.md`](./market-research.md)
