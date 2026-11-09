/**
 * @jest-environment node
 */
import { extractWebhookKey, parseAlloyWebhook, redactAlloyPayload } from '@/app/lib/alloy-webhook';

// Shaped like the real deliveries captured 2026-10-02 (docs/features/alloy-api.md), with
// the customer data left in on purpose: the parser must drop it.
function newOrderBody() {
  return {
    evento: 'novo_pedido',
    modulo: 'loja_delivery',
    chave: 'k',
    loja_id: 18424,
    pedido: {
      ref: 1525,
      status: 2,
      id_provedor: 1,
      created_at: '2026-10-02 20:14:06',
      aceito_em: '2026-10-02 20:14:06',
      transito_em: null,
      valor_entrega: 6,
      total: 45.39,
      valor_desconto: 10,
      total_com_descontos: 41.39,
      meio_de_pagamento: 'Pix',
      cpf_cnpj: '000.000.000-00',
      usuario: { nome: 'Fulano', telefone: '61999999999' },
      endereco_de_entrega: { logradouro: 'Rua X' },
      coordenadas_cliente: '-15.0,-47.0',
      ifood_dados: {
        ifood_display_id: '6366',
        data: { name: 'Fulano', phone: { number: '0800' } },
      },
      itens: [
        {
          quantidade: 1,
          valor: 37.9,
          cod_pdv: '218',
          nome: 'Casa Burguer + Fritas',
          categoria: 'itens integração ifood',
          complementos: [
            { quantidade: 1, valor: 0, cod_pdv: '575', nome: 'Ao Ponto' },
            { quantidade: 1, valor: 0, cod_pdv: '802', nome: 'Fritas Combo' },
          ],
        },
        {
          quantidade: 1,
          valor: 6.5,
          cod_pdv: '114',
          nome: 'Coca-Cola Original 310ml',
          complementos: [],
        },
      ],
    },
  };
}

describe('parseAlloyWebhook', () => {
  it('reads a "novo_pedido" (order under `pedido`) with its items and complements', () => {
    const parsed = parseAlloyWebhook(newOrderBody());

    expect(parsed).toMatchObject({
      kind: 'new_order',
      event: 'novo_pedido',
      externalStoreId: '18424',
      externalOrderId: '1525',
      statusCode: 2,
      statusLabel: 'accepted',
      channel: 'ifood',
    });
    expect(parsed?.order?.items).toHaveLength(2);
    expect(parsed?.order?.items[0]).toMatchObject({ codPdv: '218', quantity: 1 });
    expect(parsed?.order?.items[0]?.modifiers.map((m) => m.codPdv)).toEqual(['575', '802']);
    expect(parsed?.order).toMatchObject({
      total: 45.39,
      deliveryFee: 6,
      marketplaceOrderId: '6366',
    });
  });

  it('reads an "alteracao_de_status" (order under `dados_pedido`, status in `novo_status`)', () => {
    const { pedido, ...rest } = newOrderBody();
    const parsed = parseAlloyWebhook({
      ...rest,
      evento: 'alteracao_de_status',
      dados_pedido: { ...pedido, status: 3, id_provedor: null },
      pedido_ref: 1525,
      novo_status: 3,
    });

    expect(parsed).toMatchObject({
      kind: 'status_change',
      externalOrderId: '1525',
      statusCode: 3,
      statusLabel: 'in_transit',
      channel: 'own',
    });
  });

  it('reads a 99Food order (id_provedor 43, `didi_pedido` block) as the didifood channel', () => {
    const { pedido, ...rest } = newOrderBody();
    const parsed = parseAlloyWebhook({
      ...rest,
      evento: 'alteracao_de_status',
      dados_pedido: {
        ...pedido,
        id_provedor: 43,
        ifood_dados: undefined,
        didi_pedido: { pedido_didi_id: '5764689587951697923', data_pedido: '{"phone":"61999"}' },
      },
      pedido_ref: 1527,
      novo_status: 2,
    });

    expect(parsed).toMatchObject({ channel: 'didifood', externalOrderId: '1527' });
    expect(parsed?.order?.marketplaceOrderId).toBe('5764689587951697923');
    expect(JSON.stringify(parsed)).not.toContain('61999');
  });

  it('tells a counter order typed in by the team, and a pickup, from a delivery', () => {
    const parsed = parseAlloyWebhook({
      evento: 'novo_pedido',
      pedido: { ref: 1535, retirada: 1, criado_por: 22784, itens: [] },
    });
    const delivery = parseAlloyWebhook({
      evento: 'novo_pedido',
      pedido: { ref: 1536, retirada: 0, criado_por: null, itens: [] },
    });

    expect(parsed?.order).toMatchObject({ pickup: true, createdByStaff: true });
    expect(delivery?.order).toMatchObject({ pickup: false, createdByStaff: false });
  });

  it('labels status 4 as delivered', () => {
    expect(
      parseAlloyWebhook({
        evento: 'alteracao_de_status',
        dados_pedido: { ref: 1526 },
        novo_status: 4,
      }),
    ).toMatchObject({ statusCode: 4, statusLabel: 'delivered' });
  });

  it('keeps repeated complements, their quantity and an empty PDV code as received', () => {
    const parsed = parseAlloyWebhook({
      evento: 'novo_pedido',
      pedido: {
        ref: 1526,
        itens: [
          {
            quantidade: 4,
            valor: 27.9,
            cod_pdv: '',
            nome: 'Ester burger + Fritas + Refri Grátis',
            complementos: [
              { quantidade: 1, cod_pdv: '574', nome: 'Bem Passado' },
              { quantidade: 3, cod_pdv: '802', nome: 'Fritas Combo' },
              { quantidade: 1, cod_pdv: '574', nome: 'Bem Passado' },
              { quantidade: 1, cod_pdv: '', nome: 'Refrigerante 200ml' },
            ],
          },
        ],
      },
    });

    const [item] = parsed?.order?.items ?? [];
    expect(item).toMatchObject({ quantity: 4, price: 27.9, codPdv: '' });
    expect(item?.modifiers.map((m) => [m.codPdv, m.quantity])).toEqual([
      ['574', 1],
      ['802', 3],
      ['574', 1],
      ['', 1],
    ]);
  });

  it('never carries customer data into the sanitized order', () => {
    const json = JSON.stringify(parseAlloyWebhook(newOrderBody()));

    for (const secret of ['Fulano', '61999999999', '000.000.000-00', 'Rua X', '-15.0,-47.0']) {
      expect(json).not.toContain(secret);
    }
  });

  it('recognises a cancellation by the event name and keeps an unknown status as "other"', () => {
    expect(parseAlloyWebhook({ evento: 'pedido_cancelado', pedido: { ref: 9 } })?.kind).toBe(
      'cancellation',
    );
    expect(
      parseAlloyWebhook({
        evento: 'alteracao_de_status',
        dados_pedido: { ref: 9 },
        novo_status: 7,
      }),
    ).toMatchObject({ statusCode: 7, statusLabel: 'other' });
  });

  it('has nothing to record for the validation ping or a non-object', () => {
    expect(parseAlloyWebhook({})).toBeNull();
    expect(parseAlloyWebhook(undefined)).toBeNull();
    expect(parseAlloyWebhook('x')).toBeNull();
  });
});

describe('extractWebhookKey', () => {
  it('prefers the Bearer header and falls back to `chave` in the body', () => {
    expect(extractWebhookKey('Bearer abc', { chave: 'zzz' })).toBe('abc');
    expect(extractWebhookKey(null, { chave: 'zzz' })).toBe('zzz');
    expect(extractWebhookKey(null, {})).toBeUndefined();
  });
});

describe('redactAlloyPayload', () => {
  it('masks the customer but keeps every other field as received', () => {
    const body = {
      ...newOrderBody(),
      campo_novo_que_ninguem_viu: 'visível',
    };
    (body.pedido as Record<string, unknown>).obs = 'Telefone: 06136864980 (Localizador: 75868235)';

    const redacted = redactAlloyPayload(body) as typeof body;
    const json = JSON.stringify(redacted);

    for (const secret of [
      'Fulano',
      '61999999999',
      '000.000.000-00',
      'Rua X',
      '-15.0,-47.0',
      '06136864980',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(redacted.campo_novo_que_ninguem_viu).toBe('visível');
    expect(redacted.pedido.itens[0]?.nome).toBe('Casa Burguer + Fritas');
    expect(redacted.pedido.itens[0]?.complementos[0]?.cod_pdv).toBe('575');
    expect(redacted.pedido.total).toBe(45.39);
  });

  it('does not mutate what it was given', () => {
    const body = newOrderBody();
    redactAlloyPayload(body);

    expect(body.pedido.usuario.nome).toBe('Fulano');
  });

  it('is what a parsed delivery carries as its payload', () => {
    const parsed = parseAlloyWebhook(newOrderBody());

    expect(JSON.stringify(parsed?.payload)).not.toContain('Fulano');
    expect((parsed?.payload as { evento: string }).evento).toBe('novo_pedido');
  });
});
