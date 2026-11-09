import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import path from 'path';
import { fileURLToPath } from 'url';

const filePath = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(filePath);

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Next only serves dev resources (`/_next/*`, including the HMR WebSocket) to
// localhost origins, so reaching a dev stack that runs on another machine by IP
// or LAN hostname breaks hot reload. The allowlist is per-machine, so it comes
// from APP_DEV_ALLOWED_ORIGINS (comma- or space-separated) instead of being
// hardcoded. Dev-only — production builds ignore the field entirely.
const devAllowedOrigins = (process.env.APP_DEV_ALLOWED_ORIGINS ?? '')
  .split(/[\s,]+/)
  .filter(Boolean);

// `proxy.ts` matches `/api/:path*`, and Next buffers the request body in memory
// whenever a proxy runs so that both it and the route handler can read it. The cap
// on that buffer defaults to 10 MB — and past it Next does NOT fail the request: it
// hands the handler the first 10 MB, which for a multipart upload is a body with no
// closing boundary, so `formData()` throws and the caller gets an opaque 500. Every
// upload route was affected (an NF-e batch, for instance).
//
// It is deliberately the SAME number the application enforces, so the two limits
// cannot disagree: raise APP_MAX_UPLOAD_BYTES and this rises with it. Mind what
// it costs — this many bytes are held in memory per upload in flight, so it is a
// ceiling on the web/ingestion container's memory, not just on file size.
const maxUploadBytes = Number(process.env.APP_MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: devAllowedOrigins,
  experimental: {
    proxyClientMaxBodySize: maxUploadBytes,
    // Turbopack's persistent dev cache (.next/dev/cache/turbopack) keeps
    // corrupting on this setup — garbled CSS selectors ("cmdk-group?<junk>ing"),
    // "Failed to open database / invalid digit found in string" on startup.
    // Disable it: Turbopack still runs, it just recompiles from scratch each
    // `next dev` instead of restoring a broken cache.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    root: projectRoot,
  },
  // Hide the floating Next.js dev-tools/Turbopack indicator. It's a dev-only
  // overlay (never present in production) but it floats over the bare chat widget
  // iframe during local testing. Global — Next has no per-route control for it.
  devIndicators: false,
  // Don't try to bundle bull's native modules server-side.
  serverExternalPackages: ['bull'],
  async headers() {
    const servingOverHttps = (process.env.APP_BASE_URL_FRONT ?? '').startsWith('https://');

    const csp = servingOverHttps
      ? "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'; font-src 'self' data:; worker-src 'self' blob:; upgrade-insecure-requests; block-all-mixed-content"
      : "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

    const baseHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: csp },
    ];

    if (servingOverHttps) {
      baseHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }

    // The embeddable chat widget (`/chat-widget`) is the ONE route meant to be
    // framed. The global `frame-ancestors 'none'` + `X-Frame-Options: DENY` would
    // block it everywhere (even our own same-origin test viewer), so it gets its
    // own relaxed policy: secure-by-default `'self'`, plus any operator-configured
    // customer origins from APP_WIDGET_FRAME_ANCESTORS (space-separated). We DROP
    // X-Frame-Options here because it can't express a multi-origin allowlist —
    // modern browsers honor CSP frame-ancestors instead.
    const widgetAncestors = (process.env.APP_WIDGET_FRAME_ANCESTORS ?? '').trim();
    const frameAncestors = widgetAncestors ? `'self' ${widgetAncestors}` : "'self'";
    const widgetCsp = csp.replace("frame-ancestors 'none'", `frame-ancestors ${frameAncestors}`);
    const widgetHeaders = baseHeaders
      .filter((h) => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy')
      .concat({ key: 'Content-Security-Policy', value: widgetCsp });

    return [
      // Exclude /chat-widget from the global deny so its dedicated rule wins.
      { source: '/((?!chat-widget).*)', headers: baseHeaders },
      { source: '/chat-widget', headers: widgetHeaders },
    ];
  },
};

const bundledConfig = withBundleAnalyzer(nextConfig);

// Sentry's webpack plugin instruments every chunk and processes source maps,
// which dominates dev compile time. Gate it to non-development runs so prod
// keeps full error reporting while dev (host + container) stays snappy.
const isDev = process.env.NODE_ENV === 'development';

export default isDev
  ? bundledConfig
  : withSentryConfig(bundledConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      webpack: {
        treeshake: {
          removeDebugLogging: true,
        },
      },
      widenClientFileUpload: true,
    });
