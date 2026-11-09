import '@testing-library/jest-dom';

afterAll(async () => {
  try {
    const { getRedisClientIfInitialized } = await import('@/app/lib/bull/redis');
    const redisClient = getRedisClientIfInitialized();
    if (redisClient) {
      await redisClient.quit();
    }
  } catch {
    // no-op in tests that never initialized redis
  }

  try {
    const mongoose = await import('mongoose');
    if (mongoose.default.connection.readyState !== 0) {
      await mongoose.default.disconnect();
    }
  } catch {
    // no-op in tests that never initialized mongoose
  }
});
