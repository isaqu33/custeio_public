import { createLogger } from './logger';

export function logPageLoadError(page: string, err: unknown) {
  createLogger({ page }).error({ err }, 'page data load failed');
}

export function logPageLoadRejected(page: string) {
  createLogger({ page }).warn('page data load returned unsuccessful result');
}
