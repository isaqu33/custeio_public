# Captura de compras por foto (NFC-e / cupom) e por áudio — fase do WhatsApp

> **Estado: PLANEJADO** (nada disso existe no código). **Decisão de 2026-10-10:** não construir uma tela
> de envio de foto agora. Foto de nota e áudio entram na **fase do WhatsApp** (camada AGIR), em que o
> cliente manda pelo próprio WhatsApp. Até lá, a compra sem NF-e continua pelo **"Registrar compra"**
> manual (`manual-purchase.ts`).
>
> Estágio no fluxo: **CAPTURAR**. Depende do que já existe: Registrar compra, De/Para, custo médio e o
> aviso de compra em dobro; e do que ainda não existe: o job `whatsapp.message.incoming` e uma chave
> de API de IA. Spec do canal: [`whatsapp-quick-query.md`](./whatsapp-quick-query.md).

## Por que existe

Muitos locais onde a loja compra não emitem a nota grande (NF-e): emitem a **NFC-e**, o cupom fiscal de
consumidor. A captura pela SEFAZ (`NFeDistribuicaoDFe`, ver [`sefaz-nfe.md`](./sefaz-nfe.md)) só traz
NF-e, então essas compras **nunca chegam sozinhas** e, sem elas, estoque e custo médio ficam errados.

Exemplos reais (28/09/2026): um cupom da Super Adega ("consumidor não identificado") e um do Atacadão
(identificado com o CNPJ da Loja Piloto). Os dois trazem:

- CNPJ do emitente, data e hora, e os itens (código, descrição, quantidade, unidade, valor unitário,
  total) e o total geral;
- a **chave de acesso de 44 dígitos**, impressa e dentro do QR code, mais o protocolo de autorização;
- **dados de pagamento** (bandeira e final do cartão), que o Custeio **não deve guardar**.

## O que precisa de IA e o que não precisa

| Tarefa                                                          | IA?  | Como                                                                                  |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| Ler itens, fornecedor e data de uma **foto**                    | Sim  | Visão (LLM) devolve um rascunho estruturado                                           |
| Entender um **áudio** ("comprei 3 caixas de…")                  | Sim  | Transcrição + intenção; sempre confirmar antes de gravar                              |
| Saber se a leitura está certa                                   | Não  | Soma dos itens = total do cupom (nos dois exemplos bate: 197,22 e 264,79)             |
| Não registrar a mesma nota duas vezes                           | Não  | Chave de acesso (QR ou lida); `dedupe` por chave                                      |
| Cruzar com compra digitada à mão ou NF-e que chegou depois      | Não  | Já existe o aviso de possível compra em dobro (tela Notas)                            |
| Converter a embalagem ("2 FD", "1X1,6Kg × 6", "1X3,5Kg")        | Não  | De/Para por fornecedor + código; o **EAN** impresso no cupom é uma chave estável      |

## Caminhos considerados

- **A) QR → página da SEFAZ da UF**: sem IA e sem erro de leitura, mas cada estado tem uma página
  diferente que pode mudar ou bloquear; a do DF não foi testada.
- **B) Foto + IA de visão**: serve para qualquer nota, inclusive papel térmico amassado. Exige
  conferência humana e tem custo por leitura.
- **C) Digitar** (o que existe).

**Recomendação:** B, com a chave de acesso e a soma como **verificação independente**, e sempre com
confirmação antes de gravar. A IA sugere; a soma e a chave checam; o dono decide (*trust over fake
precision*).

## Fluxo desenhado

```text
foto no WhatsApp
   ↓ whatsapp.message.incoming
IA lê → rascunho (fornecedor, data, itens, chave)
   ↓
validações sem IA: soma = total · chave já registrada? · cruza com compra/NF-e · itens sem De/Para
   ↓
mensagem de confirmação ("Super Adega, 28/09, R$ 197,22 · 6 itens — confirma?")
   ↓ confirmou
grava como compra manual (mesmo caminho do Registrar compra) → responde com o efeito no custo
```

## Regras

- A IA **nunca grava** direto: só propõe, e o texto confirmado é que vira compra.
- Descartar o trecho de pagamento (cartão, NSU, autorização): não entra no banco nem no registro.
- Item sem De/Para vira **rascunho de insumo** (já existe); item que não é de cozinha entra com o
  tipo certo (limpeza, embalagem) e fica fora do CMV.
- Sem chave legível, pedir a foto de novo em vez de aceitar sem identificador.
- O mesmo vale para o **áudio**: a cozinha ou o dono relata (compra sem nota, lote de preparo, ajuste de
  quantidade; ver a seção de voz em `whatsapp-quick-query.md`), o sistema repete o que entendeu e só
  grava após o "confirma".

## Em aberto

- Guardar a imagem do cupom (prova da compra) ou só os dados? Implica LGPD e armazenamento.
- Custo por leitura e modelo a usar (a spike com Gemini, em `upcomingImplementations.md`, não vale para
  produção: faixa gratuita, 503 frequente e uso dos dados pelo provedor). Chave da Anthropic depende da
  candidatura ao programa de startups.
- Se a "Meta Business Agent" cobra uma IA própria atrás da Cloud API comum (ver `whatsapp-quick-query.md`).
- Como casar produtos do cupom com insumos já existentes (EAN, código do fornecedor, apelidos).
