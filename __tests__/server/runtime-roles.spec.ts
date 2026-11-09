/**
 * @jest-environment node
 */

import {
  classifyRuntimeRoute,
  isRuntimeRouteEnabled,
  readRuntimeRoles,
  shouldStartWebProcess,
  type RuntimeRoles,
} from '@/app/lib/runtime-roles';

const allDisabled: RuntimeRoles = {
  loadAdminApi: false,
  loadGatewayApi: false,
  loadHttp: false,
  loadIngestionApi: false,
  loadJobs: false,
  loadUi: false,
};

describe('runtime roles', () => {
  it('classifies routes by runtime workload', () => {
    expect(classifyRuntimeRoute('/api/health/ready')).toBe('health');
    expect(classifyRuntimeRoute('/api/v1/token/analyses')).toBe('ingestion-api');
    expect(classifyRuntimeRoute('/api/users/list')).toBe('admin-api');
    expect(classifyRuntimeRoute('/organization/dashboard')).toBe('ui');
  });

  it('classifies the short probe aliases as health, not ui', () => {
    expect(classifyRuntimeRoute('/health/healthz')).toBe('health');
    expect(classifyRuntimeRoute('/health/readyz')).toBe('health');
    expect(classifyRuntimeRoute('/health')).toBe('health');
  });

  it('keeps unserved probe paths out of the ui redirect', () => {
    // A probe pointed at these must reach a 404, not a 307 to /login: an
    // orchestrator reads 3xx as success and would call a dead app healthy.
    expect(classifyRuntimeRoute('/healthz')).toBe('health');
    expect(classifyRuntimeRoute('/readyz')).toBe('health');
    // Guard the prefix: this is a UI route that merely starts with "health".
    expect(classifyRuntimeRoute('/healthcheck-report')).toBe('ui');
  });

  it('defaults new api roles from the legacy http flag', () => {
    expect(readRuntimeRoles({ APP_LOAD_HTTP: 'false', APP_LOAD_UI: 'false' })).toMatchObject({
      loadAdminApi: false,
      loadGatewayApi: false,
      loadIngestionApi: false,
    });

    expect(
      readRuntimeRoles({ APP_LOAD_HTTP: 'false', APP_LOAD_INGESTION_API: 'true' }),
    ).toMatchObject({
      loadAdminApi: false,
      loadGatewayApi: false,
      loadIngestionApi: true,
    });
  });

  it('allows only enabled route groups while keeping health available', () => {
    const ingestionOnly: RuntimeRoles = {
      ...allDisabled,
      loadIngestionApi: true,
    };

    expect(isRuntimeRouteEnabled('/api/health/ready', ingestionOnly)).toBe(true);
    expect(isRuntimeRouteEnabled('/health/healthz', ingestionOnly)).toBe(true);
    expect(isRuntimeRouteEnabled('/health/readyz', ingestionOnly)).toBe(true);
    expect(isRuntimeRouteEnabled('/api/v1/token/analyses', ingestionOnly)).toBe(true);
    expect(isRuntimeRouteEnabled('/api/users/list', ingestionOnly)).toBe(false);
    expect(isRuntimeRouteEnabled('/organization/dashboard', ingestionOnly)).toBe(false);
  });

  it('starts the web process when any ui/api role is enabled', () => {
    expect(shouldStartWebProcess({ ...allDisabled, loadGatewayApi: true })).toBe(true);
    expect(shouldStartWebProcess({ ...allDisabled, loadJobs: true })).toBe(false);
  });
});
