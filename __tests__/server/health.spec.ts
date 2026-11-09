/**
 * @jest-environment node
 */

jest.mock('@/app/lib/connect-db', () => jest.fn());
const redisPingMock = jest.fn();
jest.mock('@/app/lib/bull/redis', () => ({
  getRedisClient: jest.fn(() => ({ ping: redisPingMock })),
}));

import mongoose from 'mongoose';
import connectDB from '@/app/lib/connect-db';
import { checkReadiness } from '@/app/lib/health';

describe('health checks', () => {
  const pingMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (connectDB as jest.Mock).mockResolvedValue(undefined);
    redisPingMock.mockResolvedValue('PONG');
    (mongoose.connection as unknown as { db?: { admin: () => { ping: () => Promise<void> } } }).db =
      {
        admin: () => ({ ping: pingMock }),
      };
    pingMock.mockResolvedValue(undefined);
  });

  it('returns ok when mongo and redis are healthy', async () => {
    const res = await checkReadiness();
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ mongo: 'ok', redis: 'ok' });
  });

  it('returns fail when redis ping fails', async () => {
    redisPingMock.mockRejectedValueOnce(new Error('redis down'));
    const res = await checkReadiness();
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('fail');
    expect(res.body.checks).toEqual({ mongo: 'ok', redis: 'fail' });
    expect((res.body.errors as Record<string, string>).redis).toContain('redis down');
  });

  it('returns fail when mongo connection has no db handle', async () => {
    (mongoose.connection as unknown as { db?: unknown }).db = undefined;
    const res = await checkReadiness();
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('fail');
    expect(res.body.checks).toEqual({ mongo: 'fail', redis: 'ok' });
    expect((res.body.errors as Record<string, string>).mongo).toContain(
      'mongo connection has no db handle',
    );
  });
});
