// The worker runs under plain tsx (scripts/worker.ts), NOT under Next. Anything
// it can reach must therefore resolve without Next's module rules — most
// notably `import 'server-only'`, which is fine in a service a page imports and
// crashes the worker at boot with "Cannot find module 'server-only'".
//
// Jest cannot catch this (next/jest stubs `server-only`), and typecheck cannot
// either, so this check imports the job registry the way the worker does and
// fails if anything in that graph refuses to load.
//
//   npm run enforce:worker-imports
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const registry = await import(pathToFileURL(resolve(root, 'app/jobs/registry.ts')).href);
  const kinds = Object.keys(registry.jobRegistry ?? {});
  if (kinds.length === 0) throw new Error('job registry resolved but is empty');
  process.stdout.write(`Worker import graph check passed (${kinds.length} job kinds).\n`);
} catch (err) {
  process.stderr.write(
    `Worker import graph check FAILED — the worker would not boot:\n  ${err.message}\n`,
  );
  process.exit(1);
}
