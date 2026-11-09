import { expect, test } from '@playwright/test';
import { AppFeature, endpointFor } from '@/app/lib/features';

test.describe('API authenticated coverage', () => {
  test('health endpoints respond', async ({ request }) => {
    for (const route of ['/api/health', '/api/health/live', '/api/health/ready']) {
      const response = await request.get(route);
      expect([200, 429, 503]).toContain(response.status());
    }
  });

  test('read endpoints return non-5xx', async ({ request }) => {
    const responses = await Promise.all([
      request.get(endpointFor(AppFeature.USERS_GET_ALL)),
      request.get(endpointFor(AppFeature.USERS_GET_BY_AUTH)),
      request.get(endpointFor(AppFeature.ORGANIZATIONS_GET_ALL)),
      request.get(endpointFor(AppFeature.JOBS_GET_ALL)),
      request.get('/api/stats'),
    ]);

    for (const response of responses) {
      expect(response.status(), `Unexpected status from ${response.url()}`).toBeLessThan(500);
    }
  });
});
