// Loaded as the first import in entry-point scripts. Must have no other
// imports so its body runs before any module reads process.env (notably
// app/lib/env.ts). Mirrors Next.js: .env first, then .env.local overrides —
// but only when running on the host, because .env.local points services at
// localhost:<published-port> and would clobber the container-network DNS
// (redis-custeio, mongo-custeio) injected by docker compose.
import * as dotenv from 'dotenv';
import { existsSync } from 'node:fs';

dotenv.config();

const runningInContainer = existsSync('/.dockerenv');
if (!runningInContainer) {
  dotenv.config({ path: '.env.local', override: true });
}
