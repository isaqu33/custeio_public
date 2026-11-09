# Princípios de produto

> Registrados em 2026-09-29. Contexto: [`vision.md`](./vision.md).

## Os oito princípios

1. **Invisible by default.** O dono não deveria alimentar outro sistema todo dia. Automatizar tudo
   que puder vir do PDV, da NF-e, do estoque, do histórico e das integrações.
2. **Exception driven.** Não obrigar a analisar dezenas de gráficos. Mostrar principalmente "isso
   precisa da sua atenção".
3. **Explain everything.** Toda recomendação importante explica sua origem. Vale para compra, CMV e
   divergência. O usuário deve poder perguntar "como o Custeio chegou nesse número?".
4. **Money first.** Converter problema em impacto financeiro. Não "diferença de 16 kg", e sim
   "diferença de 16 kg, ≈ R$640".
5. **Prediction must lead to action.** Não "demanda prevista: 420 hambúrgueres", e sim "para atender
   a demanda até terça, compre 30 kg de blend na segunda".
6. **Don't replace the PDV.** Integrar em vez de competir de frente.
7. **Start simple.** Média móvel explicável antes de Machine Learning. Previsão útil, explicável e
   confiável > modelo sofisticado.
8. **Trust over fake precision.** Mostrar incerteza quando os dados não bastam; nunca fingir
   precisão.

Somam-se aos guardrails de trabalho do [`CLAUDE.md`](../../CLAUDE.md) (passo a passo, sem
over-engineering, MVP de baixo custo operacional).

## Interface: dashboard vs. WhatsApp

- **Dashboard** = configuração, investigação e exceções.
- **WhatsApp** = consumo diário da inteligência (alertas, compra recomendada, consultas rápidas).

O dono não deveria precisar abrir o dashboard todo dia.

## Modelo mental para classificar features

```text
CAPTURAR → ENTENDER → CONFERIR → PREVER → RECOMENDAR → AGIR
```

| Etapa      | Exemplos                                                              |
| ---------- | --------------------------------------------------------------------- |
| CAPTURAR   | NF-e (XML/PDF/SEFAZ), webhook e catálogo do PDV, contagem de estoque  |
| ENTENDER   | ficha técnica, custo médio, CMV, margem, precificação                 |
| CONFERIR   | CMV teórico vs. real, divergências, estoque negativo, venda sem ficha |
| PREVER     | forecast de consumo por insumo, cobertura de estoque                  |
| RECOMENDAR | quanto/quando comprar, com múltiplos e lead time do fornecedor        |
| AGIR       | alerta e consulta no WhatsApp, "ver cálculo"                          |

Ao propor uma feature, dizer em qual etapa ela cai e **de qual etapa anterior ela depende**. Uma
feature de PREVER sem CAPTURAR/CONFERIR confiável por baixo é sinal de que a ordem está errada (ver
[`roadmap.md`](./roadmap.md)). Serve também como freio contra feature creep.

## Classificação atual das capacidades

| Capacidade                                                        | Papel na visão                                    |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| Captura de NF-e, De/Para, catálogo do PDV                         | **Core** — CAPTURAR                               |
| Ficha técnica, custo médio, CMV                                   | **Core** — ENTENDER                               |
| Reconciliação, divergência, cobertura                             | **Core** — CONFERIR / PREVER                      |
| Recomendação de compra, WhatsApp                                  | **Core** — RECOMENDAR / AGIR                      |
| **Precificação** (margem, preço sugerido)                         | **Secundária/complementar** — continua no produto |
| Multiempresa/multiloja, usuários, admin, jobs, auditoria, billing | Plataforma (habilitadora)                         |
