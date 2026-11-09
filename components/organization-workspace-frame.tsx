'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCopy } from '@/app/lib/i18n/client';
import { OrganizationScopeSelector } from '@/components/organization-scope-selector';

// Pages that report ON a tenant get the scope bar; pages that administer the
// platform do not, because a selector that filters nothing is a lie about what
// the page shows.
//
// Some System pages are in the list, and each belongs: `/system/spend` reports
// per-organization spend, `/system/modalities` sets a per-organization exam
// scope, and `/system/users` narrows its list to one organization's members, so
// "which organization" is exactly the question the selector answers on each.
// Their ACCESS is still System-only — that is decided by the route group and the
// feature registry, not by this bar.
const ORGANIZATION_WORKSPACE_PATHS = new Set([
  '/system/spend',
  '/system/modalities',
  '/system/audit-events',
  '/system/users',
  '/system/jobs',
  '/organization/analyses',
  '/organization/dashboard',
  '/organization/new-analysis',
  '/organization/widget',
  '/organization/stock',
  '/organization/preparations',
  '/organization/invoices',
  '/organization/prices',
  '/organization/products',
  '/organization/modifiers',
  '/organization/orders',
  '/organization/sales',
  '/organization/internal-use',
  '/system/pos-events',
]);

export function OrganizationWorkspaceFrame({
  children,
  hasSystemAccess,
}: {
  children: ReactNode;
  // Only a System/Support session picks which organization to look at — a
  // tenant session has exactly the organizations `Users.organizationIds` gives
  // it and no notion of "scope" to switch, so the bar (and its "todas as
  // organizações" option, which only ever meant "everything the session can
  // see" but read as platform-wide) must not render for it at all, even on a
  // path this set lists for System.
  hasSystemAccess: boolean;
}) {
  const pathname = usePathname();
  const copy = useCopy();

  if (!hasSystemAccess || !ORGANIZATION_WORKSPACE_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="border-b bg-background px-4 py-3 md:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{copy.organizationWorkspace.label}</p>
            <p className="text-xs text-muted-foreground">
              {copy.organizationWorkspace.description}
            </p>
          </div>
          <OrganizationScopeSelector className="w-full md:w-80" />
        </div>
      </div>
      {children}
    </div>
  );
}
