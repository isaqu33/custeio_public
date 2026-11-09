import { v4 as uuid } from 'uuid';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { z } from 'zod';
import { HttpError } from './errors';
import { createLogger } from './logger';
import { rateLimit } from './rate-limit';
import { getClientIpFromHeaders } from './client-ip';
import { env } from './env';
import { ApiErrorCode } from './api-errors';
import type { AppFeature } from './features';

export const REQUEST_ID_HEADER = 'x-request-id';

export function withRequestContext(req: Request) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? uuid();
  const url = new URL(req.url);
  const log = createLogger({
    requestId,
    path: url.pathname,
    method: req.method,
  });
  return { requestId, log };
}

type RouteHandler<Ctx> = (
  _req: Request,
  _ctx: Ctx,
  _obs: { requestId: string; log: Logger },
) => Promise<Response>;

function errorResponse(status: number, error: ApiErrorCode, requestId: string): Response {
  return new Response(JSON.stringify({ done: false, error }), {
    status,
    headers: {
      'content-type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

export function withObservability<Ctx>(name: AppFeature, handler: RouteHandler<Ctx>) {
  return withObservabilityConfig(name, handler, { rateLimit: true });
}

type RouteRateLimitOptions =
  | boolean
  | {
      limit: number;
      scope?: string;
    };

type RouteOptions = {
  rateLimit?: RouteRateLimitOptions;
  // Applied only to the responses the wrapper itself produces (rate-limit,
  // domain errors, 500s). Responses the handler returns are left untouched, so a
  // route that computes per-request headers — the widget's CORS allow-origin —
  // keeps full control of its own success path.
  decorateError?: (_res: Response, _req: Request) => Response;
};

function withObservabilityConfig<Ctx>(
  name: string,
  handler: RouteHandler<Ctx>,
  options: RouteOptions,
) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const { requestId, log } = withRequestContext(req);
    const scopedLog = log.child({ route: name });
    const startedAt = Date.now();

    const reject = (status: number, error: ApiErrorCode): Response => {
      const res = errorResponse(status, error, requestId);
      return options.decorateError ? options.decorateError(res, req) : res;
    };

    const rateLimitOption = options.rateLimit ?? true;
    if (rateLimitOption) {
      const ip = getClientIpFromHeaders(req.headers);
      const limit =
        typeof rateLimitOption === 'object'
          ? rateLimitOption.limit
          : env.APP_RATE_LIMIT_DEFAULT_PER_MIN;
      const scope = typeof rateLimitOption === 'object' ? (rateLimitOption.scope ?? name) : name;

      if (await rateLimit(scope, ip, limit)) {
        scopedLog.warn({ ip, scope, limit }, 'route rate limited');
        return reject(429, ApiErrorCode.TOO_MANY_REQUESTS);
      }
    }

    try {
      const res = await handler(req, ctx, { requestId, log: scopedLog });
      res.headers.set(REQUEST_ID_HEADER, requestId);
      const durationMs = Date.now() - startedAt;
      scopedLog.info({ status: res.status, durationMs }, 'route completed');
      return res;
    } catch (err) {
      const durationMs = Date.now() - startedAt;

      // Known domain errors → respond with their declared status + message.
      // Routes can `throw new NotFoundError('Exam not found.')` instead of
      // hand-rolling `return NextResponse.json(..., { status: HttpStatus.NOT_FOUND })`.
      if (err instanceof HttpError) {
        scopedLog.warn(
          { status: err.status, durationMs, message: err.message },
          'route rejected with domain error',
        );
        return reject(err.status, err.code);
      }

      // Mongoose `CastError` (e.g. an invalid ObjectId reaching the query
      // layer) and Zod parse failures are client mistakes — treat as 400.
      if (err instanceof mongoose.Error.CastError) {
        scopedLog.warn({ err: err.message, durationMs }, 'route rejected cast error');
        return reject(400, ApiErrorCode.INVALID_INPUT);
      }
      if (err instanceof z.ZodError) {
        scopedLog.warn({ issues: err.issues, durationMs }, 'route rejected zod error');
        return reject(400, ApiErrorCode.INVALID_INPUT);
      }

      // Anything else is a bug — log the full error and return an opaque
      // 500. The real cause is in the structured log; the response body
      // stays generic so we don't leak implementation detail.
      scopedLog.error({ err, durationMs }, 'route unhandled error');
      return reject(500, ApiErrorCode.INTERNAL_SERVER_ERROR);
    }
  };
}

export function withObservabilityOptions<Ctx>(
  name: AppFeature,
  handler: RouteHandler<Ctx>,
  options: RouteOptions,
) {
  return withObservabilityConfig(name, handler, options);
}

/**
 * Same wrapper for routes that have no `AppFeature` behind them — the public
 * widget surface, reached with an organization API token instead of a session,
 * so there is no permission to name. They still need the request id, the
 * structured route log and the catch-all that turns a thrown error into a clean
 * response instead of a bare Next 500 that never reaches the logs.
 */
export function withPublicObservability<Ctx>(
  name: string,
  handler: RouteHandler<Ctx>,
  options: RouteOptions = {},
) {
  return withObservabilityConfig(name, handler, options);
}
