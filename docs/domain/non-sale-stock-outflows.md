# Saídas de estoque sem venda: consumo interno/cortesia e avarias

> Registrado em 2026-10-02 como **direção**, não como requisito rígido.
>
> **Estado (2026-10-10):** o **consumo interno** (seção 1) está **IMPLEMENTADO** como o tipo de
> movimento `internal_use`, na página **Consumo interno** (`/organization/internal-use`). As
> **avarias** (seção 2) também: tipo `waste` (motivos vencimento, quebra, avaria no recebimento e
> outro, sem pessoa), na aba **Avarias** da mesma página. Ainda **não** há ligação da avaria no
> recebimento com a NF-e nem com o fornecedor. Decisões tomadas: nome "Consumo interno"; um tipo de
> movimento com `reason` (`employee`, `courtesy`, `donation`, `other`); baixa **por insumo** (não por
> produto vendável ainda); a pessoa é um **rótulo** (`personName`) com total por pessoa no mês; sai ao
> **custo médio** do momento, e esse custo é o que a pessoa paga; quem tem acesso à organização
> registra (hoje, o dono). Não há controle de pagamento nem saldo por pessoa. Código:
> `services/internal-use.ts`, `api/raw-ingredients/internal-use`, `components/internal-use-dialog.tsx`.

Estágio no fluxo: **ENTENDER** (explicar para onde o estoque foi) e base do **CONFERIR**. Sem isso, a
reconciliação trata toda saída que não é venda como divergência/desperdício suspeito.

## Por que existe

```text
consumo observado − consumo esperado (vendas × ficha) = divergência
```

Existem saídas **legítimas e conhecidas** que não passam pelo PDV como venda. Se não forem
registradas, entram na divergência como "possível perda" e o alerta perde credibilidade (*trust over
fake precision*). Registrá-las separa **o que foi explicado** do **que continua sem explicação**.

## 1. Consumo interno / cortesia ("fiado")

Casos: lanche consumido por colaborador, lanche doado, cortesia.

- O insumo sai do estoque **ao preço de custo** (custo da ficha técnica no momento), **sem receita**.
- Impacto em R$ = custo, nunca preço de venda. Entra como custo operacional, não como CMV de venda.
- Separar por **motivo**: `colaborador`, `doação`, `cortesia`/outro. Permite ao dono ver quanto a
  casa "gasta" por motivo no mês.
- Opcionalmente associar a uma pessoa (colaborador) só como rótulo, **sem** virar RH nem conta-corrente.

**Termo "fiado":** no uso comum fiado é venda a prazo (contas a receber). Aqui **não é isso**: não há
cobrança, saldo de cliente nem financeiro (isso seria ERP, fora do escopo). É uma baixa de estoque
com motivo. Sugestão: no produto chamar de **"Consumo interno"** e não "fiado", para não sugerir
controle financeiro.

### Registro tem que ser trivial

Princípio *invisible by default*: o cliente só **avisa** que algo saiu por essa modalidade.

- Informar **produto vendável** (ex.: 1 X-Bacon) + motivo; o sistema baixa os ingredientes pela
  ficha técnica ao custo. Não pedir ingrediente por ingrediente.
- Canais candidatos: botão rápido na tela de estoque/produtos e, depois, mensagem curta no WhatsApp
  (camada AGIR; ver [`features/whatsapp-quick-query.md`](../features/whatsapp-quick-query.md)).
- Se o PDV permitir marcar um pedido como consumo interno/cortesia, **capturar dali** em vez de pedir
  registro manual (a verificar no payload real do webhook Alloy).

Depende de: **ficha técnica** do produto (ENTENDER) e custo médio dos insumos — ambos existentes.

## 2. Avarias

Item que chegou quebrado, rasgado, amassado, vencido ou estragado e **não entra no estoque
utilizável**.

- Dois momentos possíveis:
  - **no recebimento**: a NF-e foi capturada com a quantidade total, mas parte é inutilizável → baixa
    da parte avariada;
  - **no estoque**: item estraga/vence/cai depois de recebido.
- Valorada ao custo (custo real/landed do insumo), em R$.
- Motivo (`avaria no recebimento`, `vencimento`, `quebra/queda`, `outro`) e nota opcional.
- Avaria **no recebimento** é argumento de negociação/devolução com o fornecedor — guardar o
  fornecedor/NF de origem quando houver (o ledger já guarda fornecedor nas compras).
- Registro simples: insumo + quantidade + motivo. Sem foto/fluxo de devolução no início.

Depende de: estoque por insumo e ledger (existentes).

## Como encaixa no domínio

- Ambas são **movimentos de saída no ledger** (`StockMovements`) com tipo/motivo próprios, não
  vendas e **sem receita**. Mesmos campos básicos: quantidade na unidade do insumo, custo unitário,
  valor, quem registrou, quando, nota.
- Reconciliação passa a ser:

```text
consumo observado
 − consumo esperado (vendas × ficha)
 − consumo interno registrado
 − avarias registradas
 = divergência sem explicação
```

- Relatório "Money first": R$ de consumo interno por motivo, R$ de avarias por fornecedor/motivo.
- **Previsão de compra** deve considerar essas saídas como parte do consumo histórico real (avarias
  recorrentes de um item mudam a quantidade a comprar), mas isso só depois de P0/P1A.

## Decisões em aberto

- Nome final no produto ("Consumo interno", "Cortesia", "Baixa sem venda").
- Um tipo de movimento com campo `reason`, ou tipos separados (`internal_use`, `waste`)?
- Baixa por produto vendável (via ficha) vs. por insumo avulso — suportar os dois?
- Consumo interno de colaborador fica ligado a uma pessoa ou só a um motivo?
- Capturar do PDV (se o Alloy sinalizar cortesia/consumo interno) ou só registro manual?
- Avaria no recebimento: ajusta o custo médio/landed da compra ou só baixa a quantidade? (se o
  fornecedor reembolsa, o custo efetivo muda)
- Idempotência/auditoria: quem pode registrar e se exige confirmação de gestor (evitar uso para
  esconder furto).
- Ordem de implementação: o ledger já existe, mas a utilidade real vem junto com a baixa por receita
  (P0); registrar avaria isolada antes disso já é válido (é só um movimento de saída por insumo).

## Referências

[Stock](../features/stock.md) · [Stock and real CMV](../features/stock-and-cmv.md) ·
[CMV, divergência e confiança](./cmv-reconciliation.md) · [Inventory intelligence](./inventory-intelligence.md)
