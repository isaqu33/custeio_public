import { expect, test } from '@playwright/test';

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function filterBySearch(page: import('@playwright/test').Page, value: string) {
  // The listing search moved into the filter card, whose placeholder is built
  // from the selected field ("Search by Name"), not a fixed "Search...".
  await page.getByPlaceholder(/^Search by/).fill(value);
  await page.getByRole('button', { name: 'Filter' }).click();
}

test.describe.serial('UI CRUD detailed flows', () => {
  test('Users CRUD via UI', async ({ page }) => {
    const name = uniqueId('e2e-user');
    const email = `${name}@example.com`;
    const updatedName = `${name}-updated`;

    await page.goto('/system/users');

    await page.locator('button[title="Create user"]').first().click();
    await expect(page.getByRole('heading', { name: 'Create User' })).toBeVisible();
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').first().fill('Admin12345!');
    await page.getByPlaceholder('Confirm your Password').fill('Admin12345!');
    await page.getByRole('button', { name: 'Create' }).last().click();

    await expect(page.getByRole('heading', { name: 'Create User' })).not.toBeVisible();
    await filterBySearch(page, name);
    await expect(page.locator('tr', { hasText: email }).first()).toBeVisible();

    const row = page.locator('tr', { hasText: email }).first();
    const updateHeading = page.getByRole('heading', { name: 'Update User' });
    // Retry the click until the dialog opens rather than clicking twice on an
    // immediate isVisible() — the second click lands on the modal overlay and
    // toggles the dialog, detaching the element mid-interaction.
    await expect(async () => {
      await row.locator('button[title="Update user"]').click();
      await expect(updateHeading).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByLabel('Name').fill(updatedName);
    await page.getByRole('button', { name: 'Update' }).last().click();
    await expect(page.getByRole('heading', { name: 'Update User' })).not.toBeVisible();

    await filterBySearch(page, updatedName);
    const updatedRow = page.locator('tr', { hasText: updatedName }).first();
    await expect(updatedRow).toBeVisible();

    const confirmDelete = page.getByRole('button', { name: 'Yes' });
    await expect(async () => {
      await updatedRow.locator('button[title="Delete"]').click();
      await expect(confirmDelete).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await confirmDelete.click();

    await filterBySearch(page, updatedName);
    await expect(page.locator('tr', { hasText: email })).toHaveCount(0);
  });

  test('Organizations CRUD via UI', async ({ page }) => {
    const orgName = uniqueId('e2e-org');
    const orgUpdatedName = `${orgName}-updated`;
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const renewal = nextMonth.toISOString().slice(0, 10);

    await page.goto('/system/organization');

    await page.locator('button[title="Create"]').first().click();
    await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();
    await page.getByLabel('Organization Name').fill(orgName);
    await page.getByLabel('Contact Email (Optional)').fill(`${orgName}@example.com`);
    await page.getByLabel('Jobs Limit / month').fill('200');
    await page.getByLabel('Renewal Date').fill(renewal);
    await page.getByLabel('Phone (Optional)').fill('555-0001');
    await page.getByRole('button', { name: 'Create' }).last().click();

    await expect(page.getByRole('heading', { name: 'Create Organization' })).not.toBeVisible();
    await filterBySearch(page, orgName);
    const row = page.locator('tr', { hasText: orgName }).first();
    await expect(row).toBeVisible();

    await row.locator('button[title="Update"]').click();
    await expect(page.getByRole('heading', { name: 'Update Organization' })).toBeVisible();
    await page.getByPlaceholder('Organization name').fill(orgUpdatedName);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('heading', { name: 'Update Organization' })).not.toBeVisible();

    await filterBySearch(page, orgUpdatedName);
    const updatedRow = page.locator('tr', { hasText: orgUpdatedName }).first();
    await expect(updatedRow).toBeVisible();

    await updatedRow.locator('button[title="Disable organization"]').click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(updatedRow.getByText('Inactive')).toBeVisible();

    await updatedRow.locator('button[title="Enable organization"]').click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(updatedRow.getByText('Active')).toBeVisible();

    await updatedRow.locator('button[title="Delete"]').click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await filterBySearch(page, orgUpdatedName);
    await expect(page.locator('tr', { hasText: orgUpdatedName })).toHaveCount(0);
  });

  test('Jobs create flow via UI', async ({ page }) => {
    await page.goto('/system/jobs');
    await page.getByRole('button', { name: 'Create' }).first().click();
    await expect(page.getByRole('heading', { name: 'Create Ad-Hoc Job' })).toBeVisible();
    await page.getByRole('button', { name: 'Create' }).last().click();
    await expect(page.getByRole('heading', { name: 'Create Ad-Hoc Job' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  });
});
