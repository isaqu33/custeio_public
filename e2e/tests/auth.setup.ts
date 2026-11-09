import { expect, test } from '@playwright/test';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import UsersDB from '@/app/models/users';
// cspell:ignore networkidle domcontentloaded

const STORAGE_STATE = resolve(__dirname, '../.auth/user.json');
const optionalEnv = (name: string) => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

const EMAIL = optionalEnv('E2E_USER_EMAIL') ?? 'e2e.admin@example.com';
const PASSWORD = optionalEnv('E2E_USER_PASSWORD') ?? 'admin';
const NEW_PASSWORD = process.env.E2E_USER_NEW_PASSWORD ?? 'Admin12345!';

async function ensureE2eUser() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for e2e auth setup.');

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(databaseUrl);
  }

  await UsersDB.updateOne(
    { email: EMAIL },
    {
      $set: {
        email: EMAIL,
        name: 'E2E Admin',
        password: await bcrypt.hash(PASSWORD, 10),
        systemLevel: ['system'],
        mustChangePassword: false,
        urlString: '',
      },
      $setOnInsert: {
        organizationIds: [],
      },
    },
    { upsert: true },
  );
}

const onLoginPage = (page: import('@playwright/test').Page) =>
  new URL(page.url()).pathname.endsWith('/login');

// Exact matches. `getByLabel` matches substrings, and the password field sits next
// to a show/hide toggle labelled "Show password" — a loose 'Password' resolves to
// both and fails strict mode before anything is typed.
const emailField = (page: import('@playwright/test').Page) =>
  page.getByLabel('Email', { exact: true });
const passwordField = (page: import('@playwright/test').Page) =>
  page.getByLabel('Password', { exact: true });

async function signIn(page: import('@playwright/test').Page, password: string) {
  await page.goto('/login');
  // Wait for the login form to actually render — under a cold dev-server start
  // the /login route compiles on demand, so the inputs may not exist yet.
  await emailField(page).waitFor({ state: 'visible', timeout: 60_000 });

  // Cold start is fragile in two ways: (1) the React form may not be hydrated
  // when we submit, so the click is swallowed and we never leave /login; and
  // (2) a successful sign-in's redirect can take >15s while the landing route
  // compiles, so a naive short wait gives up on a login that actually worked —
  // and a blind retry would then type into the already-authenticated page and
  // hang. So: re-submit only while still on /login, guard every action, and
  // wait generously for the redirect.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!onLoginPage(page)) return; // a prior (slow) attempt already landed
    try {
      // Two steps: the password field only mounts after the email is accepted, so
      // Continue has to land before Password can be filled. A retry may start on
      // step 2 already, hence the conditional first half.
      if (await emailField(page).isVisible()) {
        await emailField(page).fill(EMAIL, { timeout: 10_000 });
        await page.getByRole('button', { name: 'Continue' }).click({ timeout: 10_000 });
      }
      await passwordField(page).waitFor({ state: 'visible', timeout: 15_000 });
      await passwordField(page).fill(password, { timeout: 10_000 });
      await page.getByRole('button', { name: 'Sign In' }).click({ timeout: 10_000 });
    } catch {
      // The page navigated away mid-action (the login landed) — stop retrying.
      if (!onLoginPage(page)) return;
      continue;
    }
    const leftLogin = await page
      .waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    if (leftLogin) return;
  }
}

test('authenticate and persist session', async ({ page }) => {
  // One-time auth bootstrap. Under a cold parallel smoke run the dev server
  // compiles /login and the post-login route on demand, which can blow past the
  // default 30s budget — be generous so the suite isn't flaky on a fresh start.
  test.setTimeout(180_000);
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  try {
    await ensureE2eUser();

    await signIn(page, PASSWORD);
    if (page.url().endsWith('/login') && PASSWORD !== NEW_PASSWORD) {
      await signIn(page, NEW_PASSWORD);
    }

    if (page.url().includes('/change-password')) {
      await page.getByPlaceholder('At least 8 characters').fill(NEW_PASSWORD);
      await page.getByPlaceholder('Repeat new password').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Change password' }).click();
      await page.waitForURL('**/login', { timeout: 60_000 });
      await signIn(page, NEW_PASSWORD);
    }

    await page.waitForURL(/\/(dashboard|users|organization|jobs|system|exams|gateway-quarantine)?/);
    await expect(page).not.toHaveURL(/\/login$/);
    await page.context().storageState({ path: STORAGE_STATE });

    // Warm the protected routes while authenticated. The dev server compiles
    // each page on first hit; doing it here (the dependent UI specs wait for
    // setup to finish) means those specs don't each race a cold compile and
    // blow the default 30s budget. Compilation is cached server-side, so every
    // worker benefits. Best-effort — a slow/failed warm-up must not fail setup.
    for (const route of [
      '/organization/dashboard',
      '/system/jobs',
      '/system/organization',
      '/system/users',
    ]) {
      await page
        .goto(route, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(() => undefined);
    }
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
});
