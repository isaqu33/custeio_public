import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test.skip('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/login/i);
  });
});
