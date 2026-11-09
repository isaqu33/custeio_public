export type RuntimeRoles = {
  readonly loadAdminApi: boolean;
  readonly loadGatewayApi: boolean;
  readonly loadHttp: boolean;
  readonly loadIngestionApi: boolean;
  readonly loadJobs: boolean;
  readonly loadUi: boolean;
};

export type RuntimeRouteKind = 'admin-api' | 'gateway-api' | 'health' | 'ingestion-api' | 'ui';

export function parseRuntimeBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function readRuntimeRoles(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeRoles {
  const loadHttp = parseRuntimeBool(env.APP_LOAD_HTTP, true);

  return {
    loadAdminApi: parseRuntimeBool(env.APP_LOAD_ADMIN_API, loadHttp),
    loadGatewayApi: parseRuntimeBool(env.APP_LOAD_GATEWAY_API, loadHttp),
    loadHttp,
    loadIngestionApi: parseRuntimeBool(env.APP_LOAD_INGESTION_API, loadHttp),
    loadJobs: parseRuntimeBool(env.APP_LOAD_JOBS, false),
    loadUi: parseRuntimeBool(env.APP_LOAD_UI, true),
  };
}

export function shouldStartWebProcess(roles: RuntimeRoles): boolean {
  return roles.loadAdminApi || roles.loadGatewayApi || roles.loadIngestionApi || roles.loadUi;
}

export function classifyRuntimeRoute(path: string): RuntimeRouteKind {
  // `/health/*` holds the short probe aliases (`/health/healthz`, `/health/readyz`);
  // `/api/health/*` is the full JSON surface. Both must classify as health so a
  // probe gets through without a session, and so they stay reachable whatever the
  // APP_LOAD_* role flags say — the worker/ingestion containers are exactly where
  // a probe matters most and where `loadUi` is off.
  if (path === '/health' || path.startsWith('/health/')) return 'health';
  // `/healthz` and `/readyz` are served by nothing, but they are what an operator
  // reaches for out of habit. Classified as health so a misconfigured probe gets a
  // plain 404 instead of a 307 to the login page: orchestrators count 3xx as
  // success without following it, so the redirect would report a dead app —
  // Mongo and Redis unreachable — as healthy.
  if (path === '/healthz' || path === '/readyz') return 'health';
  if (path === '/api/health' || path.startsWith('/api/health/')) return 'health';
  // RayPilot's token-authenticated ingestion surface (study upload + analyses).
  if (path.startsWith('/api/v1/')) return 'ingestion-api';
  if (path.startsWith('/api')) return 'admin-api';
  return 'ui';
}

export function isRuntimeRouteEnabled(path: string, roles: RuntimeRoles): boolean {
  const kind = classifyRuntimeRoute(path);

  if (kind === 'health') return true;
  if (kind === 'ingestion-api') return roles.loadIngestionApi;
  if (kind === 'gateway-api') return roles.loadGatewayApi;
  if (kind === 'admin-api') return roles.loadAdminApi;
  return roles.loadUi;
}
