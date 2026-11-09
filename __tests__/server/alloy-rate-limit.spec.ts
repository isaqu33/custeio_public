const rateLimitMock = jest.fn();
jest.mock('@/app/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

import { reserveAlloyRequest } from '@/app/lib/alloy-rate-limit';

describe('reserveAlloyRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('budgets 2 requests per minute, keyed by store', async () => {
    rateLimitMock.mockResolvedValue(false);

    await expect(reserveAlloyRequest('store-1')).resolves.toBe(true);
    expect(rateLimitMock).toHaveBeenCalledWith('alloy-store', 'store-1', 2);
  });

  it('refuses once the store has spent its quota', async () => {
    rateLimitMock.mockResolvedValue(true);

    await expect(reserveAlloyRequest('store-1')).resolves.toBe(false);
  });
});
