/**
 * @jest-environment node
 */
export {};

// `GET /api/catalog/getproducts` reduced to products (docs/features/alloy-api.md):
// the payload's "produtos" are categories, prices are strings, `cod_pdv` is not
// unique, and a rejected store token is HTTP 200 with an error body. The fixture
// is synthetic, shaped like the real payload measured on 2026-09-26.
const envMock: { ALLOY_INTEGRATOR_TOKEN?: string; ALLOY_API_HOST?: string } = {
  ALLOY_INTEGRATOR_TOKEN: 'integrator-token',
  ALLOY_API_HOST: 'alloy.al',
};
jest.mock('@/app/lib/env', () => ({
  get env() {
    return envMock;
  },
}));

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  envMock.ALLOY_INTEGRATOR_TOKEN = 'integrator-token';
  envMock.ALLOY_API_HOST = 'alloy.al';
  global.fetch = fetchMock as unknown as typeof fetch;
});

function complement(id: number, nome: string, overrides: Record<string, unknown> = {}) {
  return { id, nome, preco: '0.00', status: 1, cod_pdv: '', ...overrides };
}

function item(id: number, nome: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    nome,
    preco: '59.50',
    preco_promocional: '0.00',
    status_promocao: 0,
    cod_pdv: '287',
    status: 1,
    categorias_de_complemento: [],
    ...overrides,
  };
}

function catalogBody() {
  return {
    status: 'success',
    code: '200',
    produtos: [
      {
        id: 1,
        nome: 'Hambúrguer Artesanal',
        status: 1,
        is_hidden: 0,
        items: [
          item(10, '  Golias  ', {
            preco: '46.90',
            categorias_de_complemento: [
              {
                id: 100,
                nome: 'Qual o ponto?',
                status: 1,
                complementos: [
                  complement(1000, 'Ao ponto', { cod_pdv: '575' }),
                  complement(1001, 'Bacon extra', { preco: '6,50' }),
                  complement(1002, 'Sem cebola', { status: 0 }),
                ],
              },
              {
                id: 101,
                nome: 'Grupo desligado',
                status: 0,
                complementos: [complement(1003, 'Molho')],
              },
            ],
          }),
          item(11, 'Combo em promoção', {
            preco: '50.00',
            preco_promocional: '39.90',
            status_promocao: 1,
          }),
          item(12, 'Promoção desligada', { preco_promocional: '10.00', status_promocao: 0 }),
          item(13, 'Item pausado', { status: 0 }),
        ],
      },
      {
        id: 2,
        nome: 'itens integração ifood',
        status: 0,
        is_hidden: 1,
        items: [item(20, 'Cópia do iFood'), item(10, 'Golias repetido')],
      },
      { id: 3, nome: 'Categoria oculta ativa', status: 1, is_hidden: 1, items: [item(30, 'X')] },
    ],
  };
}

describe('channelOfCategory', () => {
  it('reads the origin from the marketplace categories Alloy creates itself', async () => {
    const { channelOfCategory } = await import('@/app/lib/alloy-catalog');

    expect(channelOfCategory('itens integração ifood')).toBe('ifood');
    expect(channelOfCategory('itens integração didifood')).toBe('didifood');
    expect(channelOfCategory('Hambúrguer com Fritas')).toBe('own');
  });
});

describe('parseAlloyCatalog', () => {
  it('flattens categories into products keyed by the item id', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');

    const products = parseAlloyCatalog(catalogBody());

    expect(products.map((product) => product.externalId)).toEqual([
      '10',
      '11',
      '12',
      '13',
      '20',
      '30',
    ]);
    expect(products[0]).toMatchObject({
      externalId: '10',
      name: 'Golias',
      categoryName: 'Hambúrguer Artesanal',
      price: 46.9,
      codPdv: '287',
      isActive: true,
    });
  });

  it('keeps the first appearance of an item listed twice', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');

    const products = parseAlloyCatalog(catalogBody());

    expect(products.filter((product) => product.externalId === '10')).toHaveLength(1);
    expect(products.find((product) => product.externalId === '10')?.name).toBe('Golias');
  });

  it('is active only when the item and its category are on and visible', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');
    const byId = Object.fromEntries(
      parseAlloyCatalog(catalogBody()).map((product) => [product.externalId, product.isActive]),
    );

    expect(byId).toMatchObject({ '10': true, '13': false, '20': false, '30': false });
  });

  it('uses the promotional price only while the promotion is on', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');
    const byId = Object.fromEntries(
      parseAlloyCatalog(catalogBody()).map((product) => [product.externalId, product]),
    );

    expect(byId['11']).toMatchObject({ price: 50, promotionalPrice: 39.9 });
    expect(byId['12']?.promotionalPrice).toBeUndefined();
  });

  it('reads complements with their group, price (decimal comma too), status and PDV code', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');

    const [golias] = parseAlloyCatalog(catalogBody());

    expect(golias?.modifiers).toEqual([
      {
        externalId: '1000',
        name: 'Ao ponto',
        group: 'Qual o ponto?',
        price: 0,
        isActive: true,
        codPdv: '575',
      },
      {
        externalId: '1001',
        name: 'Bacon extra',
        group: 'Qual o ponto?',
        price: 6.5,
        isActive: true,
      },
      { externalId: '1002', name: 'Sem cebola', group: 'Qual o ponto?', price: 0, isActive: false },
      { externalId: '1003', name: 'Molho', group: 'Grupo desligado', price: 0, isActive: false },
    ]);
  });

  it('skips entries without an id or a name instead of guessing', async () => {
    const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');

    const products = parseAlloyCatalog({
      produtos: [
        {
          nome: 'C',
          status: 1,
          is_hidden: 0,
          items: [item(1, ''), { nome: 'sem id' }, item(2, 'ok')],
        },
      ],
    });

    expect(products.map((product) => product.externalId)).toEqual(['2']);
  });

  it.each([[null], [undefined], ['x'], [{}], [{ produtos: 'nope' }], [{ produtos: [null, 3] }]])(
    'returns nothing for an unusable body (%p)',
    async (body) => {
      const { parseAlloyCatalog } = await import('@/app/lib/alloy-catalog');

      expect(parseAlloyCatalog(body)).toEqual([]);
    },
  );
});

function response(init: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  jsonThrows?: boolean;
}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (key: string) => init.headers?.[key] ?? null },
    json: async () => {
      if (init.jsonThrows) throw new Error('bad json');
      return init.body;
    },
  };
}

describe('fetchAlloyCatalog', () => {
  it('returns the parsed products and the rate-limit numbers Alloy reported', async () => {
    fetchMock.mockResolvedValue(
      response({
        headers: { 'x-ratelimit-limit': '2', 'x-ratelimit-remaining': '1' },
        body: catalogBody(),
      }),
    );
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    const result = await fetchAlloyCatalog({ apiKey: 'store-token' });

    expect(result).toMatchObject({ kind: 'ok', rateLimitLimit: 2, rateLimitRemaining: 1 });
    expect(result.kind === 'ok' && result.products).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.alloy.al/api/catalog/getproducts',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer store-token',
          'integrador-token': 'integrator-token',
        },
      }),
    );
  });

  it('reports a 429 as rate limited, not as a rejection', async () => {
    fetchMock.mockResolvedValue(
      response({ ok: false, status: 429, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toMatchObject({
      kind: 'rate_limited',
      rateLimitRemaining: 0,
    });
  });

  it('treats HTTP 200 with an error body as a rejection carrying Alloy’s message', async () => {
    fetchMock.mockResolvedValue(
      response({
        body: { status: 'error', code: '400', message: 'Token da loja informado é inválido.' },
      }),
    );
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toEqual({
      kind: 'rejected',
      httpStatus: 200,
      message: 'Token da loja informado é inválido.',
    });
  });

  it('rejects other non-2xx answers', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 401 }));
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toMatchObject({
      kind: 'rejected',
      httpStatus: 401,
    });
  });

  it('flags an unreadable body as a transient error', async () => {
    fetchMock.mockResolvedValue(response({ jsonThrows: true }));
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toMatchObject({ kind: 'error' });
  });

  it('flags a network failure as a transient error', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toEqual({
      kind: 'error',
      message: 'socket hang up',
    });
  });

  it('does not call Alloy when the install has no integrator token', async () => {
    envMock.ALLOY_INTEGRATOR_TOKEN = undefined;
    const { fetchAlloyCatalog } = await import('@/app/lib/alloy-client');

    expect(await fetchAlloyCatalog({ apiKey: 'k' })).toMatchObject({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
