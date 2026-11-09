import { expect, test } from '@playwright/test';

type RouteCase = { path: string; method: 'GET' | 'POST'; body?: unknown };

const PROTECTED_ROUTES: RouteCase[] = [
  { method: 'POST', path: '/api/users/list' },
  { method: 'POST', path: '/api/users/create', body: {} },
  { method: 'POST', path: '/api/users/update', body: {} },
  { method: 'POST', path: '/api/users/delete', body: {} },
  { method: 'POST', path: '/api/users/profile', body: {} },
  { method: 'POST', path: '/api/users/password', body: {} },
  { method: 'POST', path: '/api/organizations/list' },
  { method: 'POST', path: '/api/organizations/create', body: {} },
  { method: 'POST', path: '/api/organizations/update', body: {} },
  { method: 'POST', path: '/api/organizations/delete', body: {} },
  { method: 'POST', path: '/api/organizations/users', body: {} },
  { method: 'POST', path: '/api/organizations/admins', body: {} },
  { method: 'POST', path: '/api/organizations/admins/add', body: {} },
  { method: 'POST', path: '/api/organizations/admins/remove', body: {} },
  { method: 'POST', path: '/api/organizations/status', body: {} },
  { method: 'POST', path: '/api/jobs/list' },
  { method: 'POST', path: '/api/jobs/create', body: {} },
  { method: 'GET', path: '/api/system/settings' },
  { method: 'POST', path: '/api/system/settings', body: {} },
];

test.describe('API unauthenticated coverage', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route.method} ${route.path}`, async ({ request }) => {
      const response =
        route.method === 'GET'
          ? await request.get(route.path)
          : await request.post(route.path, { data: route.body ?? {} });

      expect(response.status(), `Unexpected status on ${route.path}`).toBeLessThan(500);
      expect([400, 401, 403, 405, 429]).toContain(response.status());
    });
  }

  test('analyses ingest route with invalid credentials never 5xx', async ({ request }) => {
    const response = await request.post('/api/v1/bad-token/analyses', { data: {} });
    expect(response.status(), 'Unexpected status on analyses ingest').toBeLessThan(500);
    expect([400, 401, 403, 404, 405, 415, 422, 429]).toContain(response.status());
  });
});
