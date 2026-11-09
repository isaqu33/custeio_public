/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';

// Sentry fails silently by design: a missing DSN just disables it. That makes
// every link in the chain worth pinning, because breaking one produces no error
// anywhere — only an empty issue stream nobody notices until an incident.
const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('sentry wiring contract', () => {
  it('keeps the instrumentation entry point Next actually loads', () => {
    // Renaming this file (or folding it into instrumentation-client.ts) silently
    // unloads the server and edge configs.
    expect(fs.existsSync(path.join(root, 'instrumentation.ts'))).toBe(true);

    const source = read('instrumentation.ts');
    expect(source).toMatch(/export async function register\(/);
    expect(source).toContain('./sentry.server.config');
    expect(source).toContain('./sentry.edge.config');
    expect(source).toMatch(/export const onRequestError/);
  });

  it('ships the browser DSN as a build arg, not only at runtime', () => {
    // `NEXT_PUBLIC_*` is inlined at build time: passing it only through env_file
    // produces a bundle with Sentry permanently disabled in the browser.
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_SENTRY_DSN/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_SENTRY_DSN=\$\{NEXT_PUBLIC_SENTRY_DSN\}/);

    const compose = read('docker-compose.prod.yml');
    expect(compose).toContain('NEXT_PUBLIC_SENTRY_DSN: ${NEXT_PUBLIC_SENTRY_DSN:-}');
  });

  it('documents every Sentry knob in .env.example so a deploy can set them', () => {
    const example = read('.env.example');
    for (const key of ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
      expect(example).toContain(`${key}=`);
    }
  });

  it('initializes Sentry in the worker, which is not a Next runtime', () => {
    const worker = read('scripts/worker.ts');
    expect(worker).toContain('Sentry.init(');
    expect(worker).toMatch(/process\.on\('unhandledRejection'/);
    expect(worker).toMatch(/process\.on\('uncaughtException'/);
  });
});
