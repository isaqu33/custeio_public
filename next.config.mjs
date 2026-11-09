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
  // Hide the floating Next.js dev-tools/Turbopack indicator (dev-only overlay).
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

    return [{ source: '/(.*)', headers: baseHeaders }];
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
