/**
 * @jest-environment node
 */
export {};

// One real Alloy call, used by the "Testar conexão" action — what matters:
// the rate-limit numbers come straight off Alloy's response headers (see
// docs/features/alloy-api.md), never a counter we maintain ourselves.
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

function response(init: {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return {
    ok: init.ok,
    status: init.status,
    headers: { get: (key: string) => init.headers?.[key] ?? null },
    json: async () => (init.body === undefined ? [] : init.body),
  };
}

describe('testAlloyConnection', () => {
  it('reads the rate-limit headers off a successful response', async () => {
    fetchMock.mockResolvedValue(
      response({
        ok: true,
        status: 200,
        headers: { 'x-ratelimit-limit': '2', 'x-ratelimit-remaining': '1' },
      }),
    );
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'store-token' });

    expect(result).toMatchObject({ ok: true, rateLimitLimit: 2, rateLimitRemaining: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.alloy.al/api/catalog/getproducts',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer store-token',
          'integrador-token': 'integrator-token',
        }),
      }),
    );
  });

  it('fails a 200 whose body says the store token is invalid', async () => {
    fetchMock.mockResolvedValue(
      response({
        ok: true,
        status: 200,
        body: { status: 'error', code: '400', message: 'Token da loja informado é inválido.' },
      }),
    );
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'random' });

    expect(result).toMatchObject({
      ok: false,
      errorMessage: 'Token da loja informado é inválido.',
    });
  });

  it('flags a 429 as rate-limited rather than as bad credentials', async () => {
    fetchMock.mockResolvedValue(
      response({
        ok: false,
        status: 429,
        headers: { 'x-ratelimit-limit': '2', 'x-ratelimit-remaining': '0' },
      }),
    );
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'store-token' });

    expect(result).toMatchObject({ ok: false, rateLimited: true, rateLimitRemaining: 0 });
  });

  it('reports the HTTP status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 401 }));
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'bad-token' });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
  });

  it('catches a network error instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'store-token' });

    expect(result).toMatchObject({ ok: false, errorMessage: 'network down' });
  });

  it('refuses to call out when the install has no integrator token configured', async () => {
    envMock.ALLOY_INTEGRATOR_TOKEN = undefined;
    const { testAlloyConnection } = await import('@/app/lib/alloy-client');

    const result = await testAlloyConnection({ apiKey: 'store-token' });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
