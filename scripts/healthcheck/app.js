// Used by the docker-compose healthcheck for the Next.js app container.
// Hits /api/health/ready (which pings Mongo and Redis) and exits 0 only if it returns 2xx.

const pino = require('pino');
const logger = pino({ name: 'healthcheck-app', level: process.env.APP_LOG_LEVEL || 'info' });

const port = process.env.PORT || 3000;
const url = `http://127.0.0.1:${port}/api/health/ready`;
const timeoutMs = Number(process.env.APP_HEALTHCHECK_HTTP_TIMEOUT_MS) || 8000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

fetch(url, { signal: controller.signal })
  .then((res) => {
    clearTimeout(timer);
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    clearTimeout(timer);
    logger.error({ err }, 'healthcheck failed');
    process.exit(1);
  });
