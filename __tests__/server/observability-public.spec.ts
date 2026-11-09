/**
 * @jest-environment node
 */
export {};

// The public wrapper is what stands between the widget surface and a bare Next
// 500: no session, no feature name, callers we do not control. These tests pin
// the four things a route outside it silently loses — request id, error mapping,
// error decoration (CORS) and the rate limit.
const rateLimitMock = jest.fn();

jest.mock('@/app/lib/rate-limit', () => ({ rateLimit: rateLimitMock }));
// `errors.ts` pulls in NextAuth (for `requireAuth`), which does not load under
// jest. Same stub the other wrapper specs use — only the shape the wrapper reads
// matters here.
jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  class NotFoundError extends HttpError {
    constructor(message = 'Not found.') {
      super(404, 'NOT_FOUND', message);
    }
  }
  return { HttpError, NotFoundError };
});

const CORS = { 'access-control-allow-origin': 'https://tenant.example' };

function decorateWithCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(res.body, { status: res.status, headers });
}

describe('withPublicObservability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimitMock.mockResolvedValue(false);
  });

  it('stamps a request id on the handler response and reuses an incoming one', async () => {
    const { withPublicObservability } = await import('@/app/lib/observability');
    const handler = withPublicObservability('widget.test', async () => new Response('ok'));

    const generated = await handler(new Request('http://localhost/api/x'), {});
    expect(generated.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/);

    const echoed = await handler(
      new Request('http://localhost/api/x', { headers: { 'x-request-id': 'caller-id' } }),
      {},
    );
    expect(echoed.headers.get('x-request-id')).toBe('caller-id');
  });

  it('turns an unexpected throw into an opaque 500 without leaking the cause', async () => {
    const { withPublicObservability } = await import('@/app/lib/observability');
    const handler = withPublicObservability('widget.test', async () => {
      throw new Error('mongo connection string is postgres://secret@host');
    });

    const res = await handler(new Request('http://localhost/api/x'), {});
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain('INTERNAL_SERVER_ERROR');
    expect(body).not.toContain('secret');
  });

  it('maps a typed domain error to its own status', async () => {
    const { withPublicObservability } = await import('@/app/lib/observability');
    const { NotFoundError } = await import('@/app/lib/errors');
    const handler = withPublicObservability('widget.test', async () => {
      throw new NotFoundError('nope');
    });

    const res = await handler(new Request('http://localhost/api/x'), {});
    expect(res.status).toBe(404);
  });

  it('decorates the responses it generates but leaves the handler response alone', async () => {
    const { withPublicObservability } = await import('@/app/lib/observability');
    const handler = withPublicObservability(
      'widget.test',
      async () => {
        throw new Error('boom');
      },
      { decorateError: decorateWithCors },
    );
    const okHandler = withPublicObservability(
      'widget.test',
      // A route that computes its own allow-origin must keep it: the wrapper
      // decorating the success path would overwrite the matched origin with the
      // fallback one.
      async () => new Response('ok', { headers: { 'access-control-allow-origin': '*' } }),
      { decorateError: decorateWithCors },
    );

    const failed = await handler(new Request('http://localhost/api/x'), {});
    const succeeded = await okHandler(new Request('http://localhost/api/x'), {});

    expect(failed.status).toBe(500);
    expect(failed.headers.get('access-control-allow-origin')).toBe('https://tenant.example');
    expect(succeeded.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rate limits on the configured scope and limit, and decorates the 429', async () => {
    rateLimitMock.mockResolvedValueOnce(true);
    const { withPublicObservability } = await import('@/app/lib/observability');
    const handler = withPublicObservability('widget.test', async () => new Response('ok'), {
      rateLimit: { scope: 'widget-scope', limit: 7 },
      decorateError: decorateWithCors,
    });

    const res = await handler(
      new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '10.0.0.1' } }),
      {},
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tenant.example');
    expect(rateLimitMock).toHaveBeenCalledWith('widget-scope', '10.0.0.1', 7);
  });
});
