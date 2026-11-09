/**
 * @jest-environment node
 */

const redisPingMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => jest.fn());
jest.mock('@/app/lib/bull/redis', () => ({
  getRedisClient: jest.fn(() => ({ ping: redisPingMock })),
}));

import mongoose from 'mongoose';
import connectDB from '@/app/lib/connect-db';
import { checkReadiness } from '@/app/lib/health';

describe('health contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (connectDB as jest.Mock).mockResolvedValue(undefined);
    (mongoose.connection as unknown as { db?: { admin: () => { ping: () => Promise<void> } } }).db =
      { admin: () => ({ ping: jest.fn().mockResolvedValue(undefined) }) };
  });

  it('returns stable payload shape when healthy', async () => {
    redisPingMock.mockResolvedValueOnce('PONG');
    const res = await checkReadiness();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: { mongo: 'ok', redis: 'ok' },
        durationMs: expect.any(Number),
        timestamp: expect.any(String),
      }),
    );
  });
});
