/**
 * @jest-environment node
 */

jest.mock('@/app/lib/health', () => ({
  checkReadiness: jest.fn(),
}));

jest.mock('@/app/lib/rate-limit', () => ({
  rateLimit: jest.fn(),
}));

import { GET as healthz } from '@/app/health/healthz/route';
import { GET as readyz } from '@/app/health/readyz/route';
import { checkReadiness } from '@/app/lib/health';
import { rateLimit } from '@/app/lib/rate-limit';

const mockCheckReadiness = jest.mocked(checkReadiness);
const mockRateLimit = jest.mocked(rateLimit);

describe('health route aliases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockResolvedValue(false);
    mockCheckReadiness.mockResolvedValue({
      statusCode: 200,
      body: {
        status: 'ok',
        checks: { mongo: 'ok', redis: 'ok' },
        durationMs: 1,
        timestamp: '2026-08-12T00:00:00.000Z',
      },
    });
  });

  it('serves healthz as a liveness probe', async () => {
    const response = await healthz(
      new Request('https://raypilot.example.com/health/healthz', {
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      }),
    );

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ status: 'ok', timestamp: expect.any(String) }),
    );
    expect(response.status).toBe(200);
    expect(mockRateLimit).toHaveBeenCalledWith('health.live', '203.0.113.10', expect.any(Number));
    // Liveness must not touch Mongo/Redis — that is readiness' job.
    expect(mockCheckReadiness).not.toHaveBeenCalled();
  });

  it('serves readyz as a readiness probe', async () => {
    const response = await readyz(new Request('https://raypilot.example.com/health/readyz'));

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: { mongo: 'ok', redis: 'ok' },
      }),
    );
    expect(response.status).toBe(200);
    expect(mockRateLimit).toHaveBeenCalledWith('health.ready', 'unknown', expect.any(Number));
    expect(mockCheckReadiness).toHaveBeenCalledTimes(1);
  });

  it('propagates a failing readiness check so the probe fails loudly', async () => {
    mockCheckReadiness.mockResolvedValueOnce({
      statusCode: 503,
      body: {
        status: 'fail',
        checks: { mongo: 'fail', redis: 'ok' },
        durationMs: 1,
        timestamp: '2026-08-12T00:00:00.000Z',
      },
    });

    const response = await readyz(new Request('https://raypilot.example.com/health/readyz'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ status: 'fail', checks: { mongo: 'fail', redis: 'ok' } }),
    );
  });
});
