<p align="center">
  <img src="public/custeio-icon-512.png" width="120" alt="Custeio" />
</p>

<h1 align="center">Custeio</h1>

<p align="center">
  <b>Camada inteligente de custos, estoque e compras para pequenos negócios de alimentação.</b><br/>
  Seu PDV vende. O Custeio confere — e ajuda a preparar a próxima compra.
</p>

---

## O problema

Todo pequeno negócio de alimentação — hamburgueria, pizzaria, lanchonete — compra insumos por nota fiscal e vende por unidade de receita (um pão, um hambúrguer, uma porção de queijo). Ninguém tem tempo de traduzir isso manualmente todo dia, então o dono acaba sem saber, em tempo real:

- Quanto de cada insumo ainda tem no estoque.
- Quanto cada prato realmente custa (CMV) depois do reajuste do último fornecedor.
- Se a margem de um item específico está saudável ou está sangrando o caixa.

O resultado de sempre: descobrir o rombo só no fechamento do mês, quando já é tarde para agir.

## O que o Custeio faz

Custeio é um **add-on invisível** — ele não substitui o PDV nem pede para o dono aprender mais uma tela. Ele roda em segundo plano, conectado ao que o negócio já usa:

1. **Lê a nota fiscal de compra automaticamente.** Assim que a NFe do fornecedor chega, o custo de cada insumo e o saldo de estoque são atualizados sozinhos.
2. **Acompanha cada venda em tempo real**, direto do PDV (hoje **Alloy**, com outras integrações a caminho).
3. **Dá baixa no estoque pela ficha técnica de cada produto** — incluindo adicionais e complementos — então o saldo sempre reflete o que foi realmente consumido, não uma estimativa.
4. **Calcula o CMV real por receita**, prato a prato, com o custo do insumo no momento exato da venda — não um custo médio genérico e desatualizado.
5. **Responde pelo WhatsApp.** "Quanto de queijo eu tenho?", "Qual a margem do X-Bacon essa semana?" — o dono pergunta e recebe a resposta na hora, sem abrir dashboard nenhum.

## Para quem é

Pequenos negócios de food service que já usam um PDV e compram insumo por nota fiscal, mas não têm — e não querem — um sistema de gestão de estoque complexo. O Custeio entrega a informação que importa (estoque e margem) sem exigir operação extra do time.

## Como ele se encaixa no dia a dia

```
Nota fiscal (NFe)  →  estoque e custo atualizados
Venda no PDV        →  baixa por receita + CMV calculado
Dono no WhatsApp     →  "quanto sobrou?", "qual a margem?"
```

Sem tela nova para aprender. Sem lançamento manual. A informação já está lá quando o dono precisa dela.

## Para onde o Custeio vai

O Custeio **não é um ERP nem substitui o PDV**: ele funciona sobre o PDV que o negócio já usa e transforma os dados que o restaurante já gera em decisões — o que aconteceu, como está agora e o que comprar antes que falte.

- **Passado:** compras, vendas, consumo, CMV e divergências.
- **Presente:** estoque, margem, cobertura e perdas.
- **Futuro:** consumo previsto por ingrediente, quando o estoque acaba e quanto comprar.

Precificação e CMV continuam no produto, como fundamentos dessa inteligência. Visão completa em [`docs/product/vision.md`](docs/product/vision.md).

## Status

Produto em desenvolvimento ativo. **Já funciona:** sincronização do cardápio do Alloy, produtos com ficha técnica, custo e margem, estoque por loja com histórico de movimentos e contagem, e captura de notas fiscais de compra por XML/PDF com De/Para de insumos. **Ainda em construção:** receber as vendas do Alloy em tempo real (baixa por receita e CMV por venda), leitura direta da SEFAZ, WhatsApp e, depois, reconciliação, previsão e recomendação de compra. O mapa exato está em [`docs/architecture/current-state.md`](docs/architecture/current-state.md).

---

<p align="center">
  <sub>Custeio — entenda seus custos, encontre as perdas, antecipe suas compras.</sub>
</p>
