/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry.isFile() && entry.name === 'route.ts') {
      files.push(full);
    }
  }

  return files;
}

// `withObservability`, `withObservabilityOptions` and `withPublicObservability`.
// The generic argument can span lines and contain `>` itself
// (`withObservabilityOptions<{ params: Promise<...> }>(`), so match it lazily.
const OBSERVABILITY_WRAPPER = /with(?:Public)?Observability(?:Options)?\s*(?:<[\s\S]*?>)?\s*\(/;

const toPosix = (file: string) => file.split(path.sep).join('/');

describe('API route contracts', () => {
  const apiRoot = path.join(process.cwd(), 'app', 'api');
  const routeFiles = walk(apiRoot);

  it('has route files discovered', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)('%s exports at least one HTTP handler', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const hasConstExport = /export const (GET|POST|PUT|PATCH|DELETE)\s*=/.test(source);
    const hasFunctionExport = /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/.test(source);
    const hasAliasExport = /export\s*\{\s*[^}]*\s+as\s+(GET|POST|PUT|PATCH|DELETE)\s*[^}]*\}/.test(
      source,
    );
    expect(hasConstExport || hasFunctionExport || hasAliasExport).toBe(true);
  });

  it.each(routeFiles)('%s has rate-limit protection path', (file) => {
    const source = fs.readFileSync(file, 'utf8');

    // Covered by centralized wrapper
    const hasObservabilityWrapper = OBSERVABILITY_WRAPPER.test(source);

    // Explicit/manual rate limiting (auth + health + any custom paths)
    const hasManualLimiter =
      source.includes('rateLimit(') || source.includes('guardGatewayRequest(');

    expect(hasObservabilityWrapper || hasManualLimiter).toBe(true);
  });

  // Rate limiting alone is not enough: a route outside the wrapper has no
  // request id, no route log and no error mapping, so a thrown error becomes a
  // bare Next 500 that never reaches the logs. Health probes stay out (they must answer while Redis or
  // Mongo is down) and NextAuth owns its own handler.
  const WRAPPER_EXEMPT = ['app/api/health', 'app/api/auth/[...nextauth]'];

  it.each(routeFiles.filter((file) => !WRAPPER_EXEMPT.some((dir) => toPosix(file).includes(dir))))(
    '%s goes through an observability wrapper',
    (file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(OBSERVABILITY_WRAPPER.test(source)).toBe(true);
    },
  );
});
