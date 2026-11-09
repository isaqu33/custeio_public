/**
 * @jest-environment node
 */
export {};

import { z } from 'zod';
import { AppFeature } from '@/app/lib/features';

const rateLimitMock = jest.fn();

jest.mock('@/app/lib/rate-limit', () => ({ rateLimit: rateLimitMock }));
jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { HttpError };
});

describe('security helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimitMock.mockResolvedValue(false);
  });

  it('client-ip prefers x-forwarded-for then x-real-ip', async () => {
    const { getClientIpFromHeaders } = await import('@/app/lib/client-ip');
    const h1 = new Headers({ 'x-forwarded-for': '10.1.1.1, 10.1.1.2', 'x-real-ip': '1.1.1.1' });
    expect(getClientIpFromHeaders(h1)).toBe('10.1.1.1');
    const h2 = new Headers({ 'x-real-ip': '1.1.1.1' });
    expect(getClientIpFromHeaders(h2)).toBe('1.1.1.1');
  });

  it('withObservability maps zod errors to 400', async () => {
    const { withObservability } = await import('@/app/lib/observability');
    const handler = withObservability(AppFeature.JOBS_GET_ALL, async () => {
      throw new z.ZodError([{ code: 'custom', path: ['a'], message: 'bad input' }]);
    });
    const res = await handler(new Request('http://localhost/api/x', { method: 'POST' }), {});
    expect(res.status).toBe(400);
  });

  it('withObservability applies route-level rate limit', async () => {
    rateLimitMock.mockResolvedValueOnce(true);
    const { withObservability } = await import('@/app/lib/observability');
    const handler = withObservability(AppFeature.JOBS_GET_ALL, async () => new Response('ok'));
    const res = await handler(new Request('http://localhost/api/x', { method: 'POST' }), {});
    expect(res.status).toBe(429);
  });
});
