import { env } from '@/app/lib/env';
import { parseAlloyCatalog, type CatalogProduct } from '@/app/lib/alloy-catalog';

export type AlloyConnectionTestResult = {
  ok: boolean;
  // Alloy answered 429: the store token is valid but its quota is spent, so
  // this says nothing about whether the credentials work — callers must not
  // record it as a connection failure.
  rateLimited?: boolean;
  httpStatus?: number;
  errorMessage?: string;
  // Read straight off Alloy's own response headers (measured 2026-09-17, see
  // docs/features/alloy-api.md) — not a counter we maintain ourselves, so it
  // can never drift from what Alloy actually enforces.
  rateLimitLimit?: number;
  rateLimitRemaining?: number;
};

function numberOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * One real call to Alloy's catalog endpoint, just to prove the store's
 * credentials work and to read the current rate-limit window off the
 * response headers. Not `pos.catalog.sync` — this is the "Testar conexão"
 * action on a Store, the same request the alloy-api.md research validated by
 * hand; it happens to be the lightest authenticated endpoint Alloy has.
 */
export async function testAlloyConnection(input: {
  apiKey: string;
}): Promise<AlloyConnectionTestResult> {
  const integratorToken = env.ALLOY_INTEGRATOR_TOKEN;
  const host = env.ALLOY_API_HOST;
  if (!integratorToken || !host) {
    return {
      ok: false,
      errorMessage: 'ALLOY_INTEGRATOR_TOKEN/ALLOY_API_HOST is not configured on this install.',
    };
  }

  try {
    const response = await fetch(`https://api.${host}/api/catalog/getproducts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'integrador-token': integratorToken,
      },
    });

    const rateLimitLimit = numberOrUndefined(response.headers.get('x-ratelimit-limit'));
    const rateLimitRemaining = numberOrUndefined(response.headers.get('x-ratelimit-remaining'));

    if (response.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        httpStatus: 429,
        errorMessage: 'Alloy rate limit reached.',
        rateLimitLimit,
        rateLimitRemaining,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        errorMessage: `Alloy respondeu ${response.status}.`,
        rateLimitLimit,
        rateLimitRemaining,
      };
    }

    // Alloy reports a rejected store token as HTTP 200 with
    // `{ status: "error", code: "400", message: "Token da loja informado é
    // inválido." }` (verified 2026-09-24), so the status code alone proves
    // nothing — the body has to be a success payload too.
    const body: unknown = await response.json().catch(() => null);
    const rejection =
      body && typeof body === 'object' && (body as { status?: unknown }).status === 'error'
        ? String((body as { message?: unknown }).message ?? 'Alloy rejected the request.')
        : body === null
          ? 'Alloy returned an unreadable response.'
          : null;
    if (rejection) {
      return {
        ok: false,
        httpStatus: response.status,
        errorMessage: rejection,
        rateLimitLimit,
        rateLimitRemaining,
      };
    }

    return { ok: true, httpStatus: response.status, rateLimitLimit, rateLimitRemaining };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export type AlloyCatalogResult =
  | {
      kind: 'ok';
      products: CatalogProduct[];
      rateLimitLimit?: number;
      rateLimitRemaining?: number;
    }
  // The store token is fine, only its quota is spent: retry later, do not
  // record it as a connection problem.
  | { kind: 'rate_limited'; rateLimitLimit?: number; rateLimitRemaining?: number }
  // Alloy answered but refused (HTTP 200 with an error body, 401, ...): a retry
  // will not fix it, the credentials or the store need attention.
  | { kind: 'rejected'; httpStatus?: number; message: string }
  // Network failure or an unreadable answer: transient.
  | { kind: 'error'; message: string };

/**
 * `GET /api/catalog/getproducts` — the whole menu in ONE request (categories,
 * items, complement groups and complements), which is why `pos.catalog.sync`
 * never needs `getitem` per product against the 2 requests/minute store quota.
 * The caller must have reserved the request (`reserveAlloyRequest`) first.
 */
export async function fetchAlloyCatalog(input: { apiKey: string }): Promise<AlloyCatalogResult> {
  const integratorToken = env.ALLOY_INTEGRATOR_TOKEN;
  const host = env.ALLOY_API_HOST;
  if (!integratorToken || !host) {
    return {
      kind: 'rejected',
      message: 'ALLOY_INTEGRATOR_TOKEN/ALLOY_API_HOST is not configured on this install.',
    };
  }

  try {
    const response = await fetch(`https://api.${host}/api/catalog/getproducts`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'integrador-token': integratorToken },
    });
    const rateLimitLimit = numberOrUndefined(response.headers.get('x-ratelimit-limit'));
    const rateLimitRemaining = numberOrUndefined(response.headers.get('x-ratelimit-remaining'));

    if (response.status === 429)
      return { kind: 'rate_limited', rateLimitLimit, rateLimitRemaining };
    if (!response.ok) {
      return {
        kind: 'rejected',
        httpStatus: response.status,
        message: `Alloy respondeu ${response.status}.`,
      };
    }

    // A rejected store token is HTTP 200 with `{ status: "error", message }`.
    const body: unknown = await response.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return { kind: 'error', message: 'Alloy returned an unreadable response.' };
    }
    const status = (body as { status?: unknown }).status;
    if (status !== 'success') {
      return {
        kind: 'rejected',
        httpStatus: response.status,
        message: String((body as { message?: unknown }).message ?? 'Alloy rejected the request.'),
      };
    }

    return { kind: 'ok', products: parseAlloyCatalog(body), rateLimitLimit, rateLimitRemaining };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' };
  }
}
