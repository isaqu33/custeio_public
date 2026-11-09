// Used by the docker-compose healthcheck for the Bull worker container.
// The worker writes a heartbeat file (only after a successful Redis ping) on a timer.
// Stale or missing file means the worker is dead or Redis is unreachable.

const fs = require('node:fs');
const pino = require('pino');
const logger = pino({ name: 'healthcheck-worker', level: process.env.APP_LOG_LEVEL || 'info' });

const path = process.env.APP_WORKER_HEARTBEAT_PATH || '/tmp/worker-heartbeat';
const maxAgeMs = Number(process.env.APP_WORKER_HEARTBEAT_MAX_AGE_MS) || 60000;

try {
  const stat = fs.statSync(path);
  const age = Date.now() - stat.mtimeMs;
  if (age > maxAgeMs) {
    logger.error({ age, maxAgeMs }, 'heartbeat stale');
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  logger.error({ err }, 'heartbeat missing');
  process.exit(1);
}
