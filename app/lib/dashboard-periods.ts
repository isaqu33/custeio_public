/**
 * Period vocabulary for the dashboard, kept apart from the service on purpose:
 * the service imports Mongoose models, and the period filter is a client
 * component. Importing the service from the client would drag `node:*` builtins
 * into the browser bundle and fail the build.
 */
export const DASHBOARD_PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = '30d';

export const PERIOD_DAYS: Record<Exclude<DashboardPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function normalizeDashboardPeriod(value: string | undefined): DashboardPeriod {
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod)
    ? (value as DashboardPeriod)
    : DEFAULT_DASHBOARD_PERIOD;
}
