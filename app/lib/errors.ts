// Typed domain errors that carry their HTTP status. Throw these inside a
// withObservability-wrapped route and the wrapper maps them to a clean JSON
// response with the right status. Anything that isn't an HttpError (or a
// recognized mongoose/zod error) still gets a generic 500 fallback.
//
// Conventions:
//   - 4xx messages are surfaced to the client as-is — they're user-fixable.
//   - 5xx messages stay generic ("Internal server error") to avoid leaking
//     implementation detail; the real cause is in the structured log.

import { ApiErrorCode } from './api-errors';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Invalid request.') {
    super(400, ApiErrorCode.BAD_REQUEST, message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized.') {
    super(401, ApiErrorCode.UNAUTHORIZED, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden.') {
    super(403, ApiErrorCode.FORBIDDEN, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') {
    super(404, ApiErrorCode.NOT_FOUND, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict.') {
    super(409, ApiErrorCode.CONFLICT, message);
    this.name = 'ConflictError';
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity.') {
    super(422, ApiErrorCode.UNPROCESSABLE_ENTITY, message);
    this.name = 'UnprocessableEntityError';
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests.') {
    super(429, ApiErrorCode.TOO_MANY_REQUESTS, message);
    this.name = 'TooManyRequestsError';
  }
}

// Convenience: require an authenticated session or throw 401. Saves the
// six-line `const session = await auth(); if (!session) return ...` block
// at the top of every protected route.
//
// `auth` is imported dynamically, not at module top level: `auth.ts` pulls in
// next-auth and (through password-hashing.ts) the `server-only` package,
// which does not exist outside Next.js. A static import would make this
// module — and every service that imports an error class from it — unsafe
// for the Bull worker (plain tsx, not Next) to load. A dynamic import here
// only resolves when a route actually calls requireAuth(), which the worker
// never does; see scripts/check-worker-imports.mjs.
export async function requireAuth() {
  const { auth } = await import('./auth');
  const session = await auth();
  if (!session) throw new UnauthorizedError();
  return session;
}
