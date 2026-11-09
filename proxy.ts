import { NextResponse, type NextRequest } from 'next/server';
import {
  classifyRuntimeRoute,
  isRuntimeRouteEnabled,
  readRuntimeRoles,
} from './app/lib/runtime-roles';

const publicRoutes = [{ path: '/login', whenAuthenticated: 'redirect' }] as const;
// Pages reachable without a session whose path carries a value. `/claim/<token>`
// is where an organization's owner lands from the invite link a salesperson sent
// them, before they have any account to sign in with.
const publicRoutePrefixes = ['/claim/'] as const;
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hasAuthSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name === 'authjs.session-token' ||
        cookie.name === '__Secure-authjs.session-token' ||
        cookie.name.startsWith('authjs.session-token.') ||
        cookie.name.startsWith('__Secure-authjs.session-token.'),
    );
}

function isTrustedSameOriginRequest(request: NextRequest): boolean {
  // Server-to-server fetches (Server Components, route handlers calling
  // their own API) do not include browser-only headers like `Origin` or
  // `Sec-Fetch-*`. They cannot originate cross-site CSRF, so accept them.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && (fetchSite === 'same-origin' || fetchSite === 'none')) {
    return true;
  }

  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    // No Origin and no Sec-Fetch-Site → not a browser. Treat as trusted.
    return !fetchSite;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    return false;
  }

  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');

  return originUrl.host === host && originUrl.protocol === `${proto}:`;
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!isRuntimeRouteEnabled(path, readRuntimeRoles())) {
    return NextResponse.json({ done: false }, { status: 404 });
  }

  // Probes carry no session cookie. `/api/health/*` already slips through the
  // `/api` branch below, but the short `/health/*` aliases would otherwise take
  // the UI path and answer 307 → /login — which an orchestrator reads as a
  // healthy app. Letting every health-classified path through keeps the probe
  // honest: it reaches the handler, or 404s if nothing serves it.
  if (classifyRuntimeRoute(path) === 'health') {
    return NextResponse.next();
  }

  if (path.startsWith('/api')) {
    if (
      mutatingMethods.has(request.method) &&
      hasAuthSessionCookie(request) &&
      !isTrustedSameOriginRequest(request)
    ) {
      return NextResponse.json({ done: false, error: 'Invalid CSRF origin.' }, { status: 403 });
    }
    return NextResponse.next();
  }

  const publicRoute =
    publicRoutes.find((rout) => rout.path === path) ??
    (publicRoutePrefixes.some((prefix) => path.startsWith(prefix))
      ? ({ path, whenAuthenticated: 'redirect' } as const)
      : undefined);

  // Variable to identify if the user is logged in.
  const hasAuthToken = hasAuthSessionCookie(request);

  // NOTE: we intentionally do NOT redirect index pages to add `?page=1`.
  // A middleware redirect on these paths poisons App Router soft navigation:
  // after it fires, `router.push` to the same path with new search params
  // (the list filters / pagination) stops updating the URL, so filtering
  // silently does nothing. The page components already default a missing
  // `page` to 1 (getSearchParamNumber(..., 'page', 1)), so the canonical URL
  // is unnecessary. `/jobs` was never in this list, which is why its filter
  // always worked.

  if (!hasAuthToken && publicRoute) {
    return NextResponse.next();
  }

  if (!hasAuthToken && !publicRoute) {
    const redirectUrl = request.nextUrl.clone();

    redirectUrl.pathname = '/login';

    return NextResponse.redirect(redirectUrl);
  }

  if (hasAuthToken && publicRoute && publicRoute.whenAuthenticated === 'redirect') {
    const redirectUrl = request.nextUrl.clone();

    redirectUrl.pathname = '/';

    return NextResponse.redirect(redirectUrl);
  }

  if (hasAuthToken && !publicRoute) {
    // Option for handling expired JWTs: use a token-decoding lib here and clear the cookie.
    return NextResponse.next();
  }

  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    '/api/:path*',
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - anything that looks like a file (e.g. .png, .svg, .jpg)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
