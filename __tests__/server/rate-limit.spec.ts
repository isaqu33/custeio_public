/**
 * @jest-environment node
 */

const consumeMock = jest.fn();

jest.mock('rate-limiter-flexible', () => ({
  RateLimiterRedis: jest.fn().mockImplementation(() => ({
    consume: consumeMock,
  })),
}));

jest.mock('@/app/lib/bull/redis', () => ({
  getRedisClient: jest.fn(() => ({})),
}));

describe('rateLimit', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('allows a request the limiter accepts', async () => {
    consumeMock.mockResolvedValue({ remainingPoints: 9 });
    const { rateLimit } = await import('@/app/lib/rate-limit');

    await expect(rateLimit('scope', '127.0.0.1', 10)).resolves.toBe(false);
  });

  it('blocks a request the limiter rejects for quota', async () => {
    // rate-limiter-flexible signals "over quota" by rejecting with the consumed
    // state, not by throwing an Error — mistaking one for the other would turn
    // every quota rejection into a fail-open.
    consumeMock.mockRejectedValue({ remainingPoints: 0, msBeforeNext: 1000 });
    const { rateLimit } = await import('@/app/lib/rate-limit');

    await expect(rateLimit('scope', '127.0.0.1', 10)).resolves.toBe(true);
  });

  it('fails open when Redis errors outright', async () => {
    // Deliberate: a Redis outage must not lock every user out of the product.
    consumeMock.mockRejectedValue(new Error('connection refused'));
    const { rateLimit } = await import('@/app/lib/rate-limit');

    await expect(rateLimit('scope', '127.0.0.1', 10)).resolves.toBe(false);
  });

  it('fails open when Redis rate-limit consumption hangs', async () => {
    jest.useFakeTimers();
    consumeMock.mockReturnValue(new Promise(() => undefined));

    const { rateLimit } = await import('@/app/lib/rate-limit');
    const result = rateLimit('scope', '127.0.0.1', 10);

    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toBe(false);
  });
});
