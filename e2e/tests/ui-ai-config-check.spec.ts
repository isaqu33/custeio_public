import { expect, test, type Page } from '@playwright/test';

/**
 * The organization form accepts a free-text model id and an API key, and until
 * this check existed both were taken on faith: a typo, a retired model or a dead
 * key saved cleanly and only surfaced hours later, in the worker, as a failed
 * analysis someone was waiting for.
 *
 * The probe is a real call to the real provider, so this spec is deliberately
 * one too — a mocked provider would prove only that our mock returns what we
 * told it to. It needs no credentials and costs nothing: an invalid key is
 * refused before any generation happens (Gemini answers HTTP 400 "API key not
 * valid"), which is exactly the class of failure the check exists to catch.
 *
 * It does need outbound network. Set E2E_NO_EGRESS=1 to skip it where there is
 * none, rather than watching it fail for the wrong reason.
 */

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function filterBySearch(page: Page, value: string) {
  await page.getByPlaceholder(/^Search by/).fill(value);
  await page.getByRole('button', { name: 'Filter' }).click();
}

// Both the primary and the fallback config render the same labels, so every
// field lookup has to be scoped to one of the two cards.
function aiCard(page: Page, label: 'Primary (required)' | 'Fallback (optional)') {
  return page
    .locator('div.rounded-lg')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
}

async function fillRequiredOrganizationFields(page: Page, orgName: string) {
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  await page.getByLabel('Organization Name').fill(orgName);
  await page.getByLabel('Jobs Limit / month').fill('200');
  await page.getByLabel('Renewal Date').fill(nextMonth.toISOString().slice(0, 10));
  await page.getByPlaceholder(/^https:\/\/clinic\.example\.com/).fill('https://e2e.example.com');
}

test.describe('AI configuration is verified against the provider before saving', () => {
  test.skip(!!process.env.E2E_NO_EGRESS, 'requires outbound network to the AI provider');

  test('a key the provider refuses blocks the save and says why', async ({ page }) => {
    const orgName = uniqueId('e2e-ai-check');

    await page.goto('/system/organization');
    await page.locator('button[title="Create"]').first().click();
    await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();

    await fillRequiredOrganizationFields(page, orgName);

    const primary = aiCard(page, 'Primary (required)');
    await primary.getByRole('combobox').click();
    await page.getByRole('option', { name: 'gemini' }).click();
    // A model that does exist, so the only thing left for the provider to reject
    // is the key — the failure under test is unambiguous.
    await primary.getByPlaceholder(/^e\.g\./).fill('gemini-3.5-flash-lite');
    await primary.getByPlaceholder('Provider API key').fill('e2e-not-a-real-key');

    await page.getByRole('button', { name: 'Create' }).last().click();

    // The provider's own sentence has to reach the admin: "something went wrong"
    // would leave them re-typing a perfectly good model id.
    await expect(page.getByText(/Primary AI configuration refused by the provider/)).toBeVisible();
    await expect(page.getByText(/API key not valid/)).toBeVisible();

    // Rejected means NOT saved — the dialog stays open on the bad value so it can
    // be corrected, and nothing was written.
    await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();
    await page.keyboard.press('Escape');
    await filterBySearch(page, orgName);
    await expect(page.locator('tr', { hasText: orgName })).toHaveCount(0);
  });
});
