# Ponte do webhook (webhook bridge)

> **Estado: IMPLEMENTADO em 2026-10-09** (a função da ponte no ar e testada; a sincronização no app
> testada com banco falso, ainda não com pedidos reais). Provisória: some quando o Custeio estiver
> hospedado (Azure) e o webhook dele receber direto.

## Por quê

O webhook do Alloy (`POST /api/v1/webhooks/alloy`) só funciona com o Custeio no ar e com URL pública.
Com o app no notebook, que às vezes está desligado, o Alloy desistiria: espera `{"status":"ok"}` em 3 s,
reenvia depois de 5 minutos e **desativa o webhook** se várias respostas seguidas forem inválidas
([alloy-api.md](./alloy-api.md)). Cada pedido gera uns 4 eventos (novo, aceito, em trânsito, entregue).

## Como funciona

```text
Alloy ──POST──▶ custeio-webhook-bridge (Vercel, sempre no ar, São Paulo)
                   │ valida a Chave, mascara dados de cliente, guarda
                   ▼
                MongoDB Atlas (grátis) — bridge.events
                   ▲
   cron bridge.pull (worker, a cada 2 min; recupera tudo ao ligar)
                   │ lê os não sincronizados, do mais antigo ao mais novo
                   ▼
   recordParsedDelivery → pos_events → job pos.order.received → baixa de estoque
```

- **Projeto da ponte:** repositório privado `custeio-webhook-bridge` (fora deste repositório), com a
  função `api/webhook.ts`. Só grava; não há rota de leitura. Dados de cliente e a `chave` nunca são
  guardados. Eventos somem sozinhos 60 dias depois.
- **A loja é achada pelo hash da Chave** (`keyHash` do evento = `Stores.webhookKeyHash`), nunca por
  algo que a entrega declare. Evento com chave sem loja é marcado `syncResult: 'no_store'` e fica na
  ponte (para reprocessar, apague o `syncedAt` dele no Atlas).
- **Mesma regra do webhook direto:** `recordParsedDelivery` (`app/lib/services/pos-events.ts`) e o
  mesmo `dedupeKey` (hash do corpo cru), então uma entrega que chegue pelos dois caminhos não duplica.
- **Cron `bridge.pull`** (Sistema > Crons): `app/lib/services/bridge-pull.ts`. Até 1.000 eventos por
  execução (5 lotes de 200). Uma falha ao gravar interrompe a execução, e o resto fica para a próxima.

## Erros: onde ver

Sistema > Eventos do PDV > aba **Erros da ponte** (`/system/pos-events?view=errors`), lida direto da
ponte por `services/bridge-errors.ts`:

- **Eventos com erro:** um evento que falha ao ser gravado é tentado até `MAX_SYNC_ATTEMPTS` (3) vezes
  e então marcado `syncResult: 'error'` (com `syncError`, sem endereço de conexão) e deixa de ser
  puxado; **os seguintes seguem** (antes, um evento ruim travaria a fila). Falha de infraestrutura
  (Mongo local ou da ponte fora) encerra a rodada sem culpar o evento. O resumo do cron mostra "N com erro".
- **Eventos sem loja:** chave que nenhuma loja conhece (ex.: a Chave foi trocada).
- **Recusas na ponte:** coleção `errors` do banco da ponte, uma linha por motivo por minuto, com
  contagem, sem corpo e sem chave, 14 dias: `no_key`, `wrong_key`, `bridge_key_not_configured`,
  `body_too_large`, `store_failed`. É o aviso de que o Alloy está mandando a Chave errada (ele
  desativa o webhook se isso continuar).
- Se o próprio banco da ponte estiver fora, a função não consegue registrar: o Alloy recebe 500 e
  reenvia em 5 minutos, e o aviso fica só no log da Vercel.

**O que fica quando o Custeio for hospedado:** a quarentena, o limite de tentativas e a aba de erros são
código do app e continuam; o que é da ponte (a função, o banco Atlas e a leitura da coleção `errors`)
some com ela. Para o webhook direto, a mesma aba pode passar a listar as recusas locais.

## Configuração

1. `BRIDGE_MONGODB_URI` no `.env` do app (string de conexão do Atlas da ponte; **segredo**, nunca no
   repositório) e, opcionalmente, `BRIDGE_MONGODB_DB` (padrão `bridge`).
2. Reiniciar o worker. O cron nasce **ligado** se a variável já existir na primeira vez que a linha é
   lida; se ela foi criada depois, ligue o cron em Sistema > Crons.
3. No Alloy (Integrações > Webhooks), URL `https://custeio-webhook-bridge.vercel.app/api/webhook`, a
   Chave do projeto da ponte e os eventos de pedido.

## Limites conhecidos

- A Chave de teste usada na primeira configuração apareceu em conversa: trocar antes de ter cliente
  pagando (novo hash em `WEBHOOK_KEY_HASH` na Vercel, redeploy e webhook recriado no Alloy).
- O `redactAlloyPayload` do app **não mascara o campo `chave`** no `payload` de `pos_events`
  (o da ponte mascara). Pendente de decisão.
- O plano Hobby da Vercel é para uso não comercial: mover o receptor antes de cobrar clientes.
