import pino from 'pino';
import { env } from './env';

const isDev = process.env.NODE_ENV === 'development';
const usePrettyLogs = isDev && (env.APP_LOG_FORMAT ?? 'pretty') === 'pretty';

export const logger = pino({
  level: env.APP_LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    service: env.APP_SERVICE_NAME,
    env: process.env.NODE_ENV ?? 'development',
  },
  redact: {
    // Anything that could leak credentials, session material, or large
    // binary payloads. Wildcards (`*.field`) catch fields nested one level
    // deep — enough for typical structured-log objects without scanning
    // arbitrary depth.
    paths: [
      // request headers
      'req.headers.authorization',
      'req.headers.cookie',
      '*.authorization',
      '*.cookie',
      // credentials / secrets
      'password',
      'token',
      'rawToken',
      'AUTH_SECRET',
      'APP_TOKEN_PEPPER',
      'connectionString',
      'APP_AZURE_STORAGE_CONNECTION_STRING',
      '*.password',
      '*.token',
      '*.rawToken',
      '*.connectionString',
      // large binary payloads
      'UTF8file',
      '*.UTF8file',
    ],
    remove: true,
  },
  ...(usePrettyLogs && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
      },
    },
  }),
});

export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
