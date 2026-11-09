// Thin wrapper around fetch with consistent JSON handling and a typed
// error class. Callers can keep treating non-2xx as recoverable (catch
// ApiError) and still inspect the app-level `done` flag on the parsed
// body for business-logic failures.

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type ApiFetchOptions = Omit<RequestInit, 'body'> & {
  // Either a plain object (auto-stringified + JSON Content-Type) or a
  // FormData / Blob (passed through; the browser sets Content-Type).
  body?: unknown;
  // 'json' (default): parse body as JSON, throw ApiError on non-2xx.
  // 'blob':           return the response body as a Blob, throw on non-2xx.
  //                   Caller can still read err.body on error (JSON parsed).
  // 'response':       return the raw Response object — caller is responsible
  //                   for status checks and reading the body. Useful when
  //                   you need headers (e.g. Content-Disposition) alongside
  //                   the body.
  responseType?: 'json' | 'blob' | 'response';
};

type Parser<T> = (_data: unknown) => T;

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
  parser?: Parser<T>,
): Promise<T> {
  const { body, headers, responseType = 'json', ...rest } = options;

  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined;

  if (body === undefined || body === null) {
    finalBody = undefined;
  } else if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
    finalBody = body;
  } else if (typeof body === 'string') {
    finalBody = body;
  } else {
    finalBody = JSON.stringify(body);
    if (!finalHeaders.has('Content-Type')) {
      finalHeaders.set('Content-Type', 'application/json');
    }
  }

  const res = await fetch(url, { ...rest, headers: finalHeaders, body: finalBody });

  if (responseType === 'response') {
    return res as unknown as T;
  }

  if (responseType === 'blob') {
    if (!res.ok) {
      // Try to surface a useful error body — the server typically sends
      // JSON on failure even when the success path returns binary.
      let errorBody: unknown;
      try {
        errorBody = await res.clone().json();
      } catch {
        errorBody = await res.text().catch(() => undefined);
      }
      throw new ApiError(res.status, errorBody);
    }
    return (await res.blob()) as unknown as T;
  }

  // Default: JSON. Try to parse the body even on non-2xx so callers can
  // inspect server-provided `error` / `message` strings via ApiError.body.
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }

  return parser ? parser(parsed) : (parsed as T);
}
