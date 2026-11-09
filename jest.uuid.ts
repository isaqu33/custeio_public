/*
  uuid v14 ships ESM only, which Jest's CJS runtime cannot parse. The package is
  used for one thing here — a random v4 id — so tests resolve it to the platform
  generator instead of transforming the dependency.
*/
import { randomUUID } from 'node:crypto';

export function v4() {
  return randomUUID();
}
