# Fornecedor: ciclo de pedido, lead time e unidade de compra

> **Estado: PLANEJADO.** Registrado em 2026-09-29. Hoje o fornecedor **não é uma entidade**: existe
> só como `supplierCnpj`/`supplierName` em `SupplierItemMappings`, em `StockMovements.source` e em
> `RawIngredients.lastPurchase`. Nada abaixo está modelado.

## Por que importa

A cobertura de estoque e a recomendação de compra dependem de **quando** o restaurante consegue
repor, não só de quanto consome — ver [`inventory-intelligence.md`](./inventory-intelligence.md) e
[`purchasing-forecast.md`](./purchasing-forecast.md).

## O que precisa ser conhecido (por fornecedor e/ou por insumo fornecido)

- fornecedor e insumo/produto fornecido;
- **dias em que aceita pedido** e **horário limite**;
- **lead time**;
- **dias de entrega** / frequência de entrega;
- **pedido mínimo**;
- **unidade e múltiplo de compra** (embalagem, quantidade mínima por pacote);
- **estoque de segurança** desejado.

## Exemplo

```text
Fornecedor: Açougue X · Insumo: Blend bovino
Pedido: segunda-feira · Entrega: terça-feira · Lead time: 1 dia
Unidade de compra: pacote de 5 kg · Pedido mínimo: 20 kg
```

O Custeio deve perceber antes: "se eu não comprar na segunda, a próxima reposição será tarde
demais", e alertar **antes do último momento seguro** para pedir.

## Notas de modelagem (a decidir quando for implementar)

- Já existe o vínculo fiscal `(storeId, supplierCnpj, supplierItemCode) → rawIngredientId` com fator
  de conversão de unidade (`SupplierItemMappings`). A unidade de **compra** (caixa de 10×1 kg) é
  parente do fator de conversão, mas não a mesma coisa que o **múltiplo de pedido** ao fornecedor.
- O CNPJ que a NF-e traz é um bom identificador natural de fornecedor; o cadastro de ciclo de pedido
  provavelmente nasce como configuração por (loja, fornecedor) pré-preenchida pelas NF-es já
  capturadas — coerente com "invisible by default".
- Entrada manual só do que a NF-e não diz (dias de pedido/entrega). Não construir cadastro completo
  de fornecedor: **não somos ERP**.
