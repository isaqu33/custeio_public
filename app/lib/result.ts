import type { HttpStatus } from './http-status';

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E; status: HttpStatus; message?: string };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E, status: HttpStatus, message?: string): Result<never, E> {
  return { ok: false, error, status, ...(message ? { message } : {}) };
}
