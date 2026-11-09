import { expect, test } from '@playwright/test';

const NAV_CASES = [
  { link: 'Dashboard', path: '/organization/dashboard', heading: 'Dashboard' },
  { link: 'Jobs', path: '/system/jobs', heading: 'Jobs' },
  { link: 'Audit Events', path: '/organization/audit-events', heading: 'Audit Events' },
  { link: 'Chat Tester', path: '/system/chat-tester', heading: 'Chat Tester' },
  { link: 'Organizations', path: '/system/organization', heading: 'Organizations' },
  { link: 'Users', path: '/system/users', heading: 'Users' },
];

test.describe('UI core flows', () => {
  test('protected root redirects into authenticated area', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(organization|system|no-access)/);
  });

  for (const navCase of NAV_CASES) {
    test(`navigates to ${navCase.link}`, async ({ page }) => {
      await page.goto('/organization/dashboard');
      // The sidebar entries are real <Link>s, so a click no longer has to wait for
      // React to hydrate and there is nothing to retry — only the cold-compile
      // latency of the target route, which the URL timeout absorbs.
      const navLink = page.getByRole('link', { name: navCase.link, exact: true });
      await expect(navLink).toBeVisible({ timeout: 20_000 });
      await navLink.click();
      await expect(page).toHaveURL(new RegExp(navCase.path), { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: navCase.heading })).toBeVisible({
        timeout: 20_000,
      });
    });
  }

  test('jobs page opens create modal and closes it', async ({ page }) => {
    await page.goto('/system/jobs');
    // Same hydration race as the nav buttons — retry the click until the modal
    // actually opens.
    const heading = page.getByRole('heading', { name: /Create Ad-Hoc Job/i });
    await expect(async () => {
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(heading).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(heading).not.toBeVisible();
  });
});
