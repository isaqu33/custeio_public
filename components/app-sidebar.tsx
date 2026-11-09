'use client';

import { NavMain } from '@/components/nav-main';
import { getSidebarNavItems, type SidebarAccess } from '@/components/app-sidebar-nav';
import { NavUser } from '@/components/nav-user';
import { CusteioLogo, CusteioMark } from '@/components/custeio-logo';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar';
import * as React from 'react';
import { useCopy, useLocale } from '@/app/lib/i18n/client';

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  // Resolved on the server and passed down as a plain array: a Set does not
  // survive the client-component boundary.
  features?: string[] | null;
  hasSystemAccess?: boolean;
}

export function AppSidebar({
  features = null,
  hasSystemAccess = false,
  ...props
}: AppSidebarProps) {
  const copy = useCopy();
  const locale = useLocale();
  const access = React.useMemo<SidebarAccess>(
    () => ({ features: features ? new Set(features) : null, hasSystemAccess }),
    [features, hasSystemAccess],
  );
  const navMain = getSidebarNavItems(copy, locale, access);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="pb-6">
        {/* Inline SVG so both "Custe" (currentColor) and "io" (the
            --custeio-wordmark token) follow the sidebar's own theme, same
            as the login lockup. Collapsed to the icon rail, the full wordmark
            has no room, so the burger mark alone (no "Custeio" text) takes
            over. */}
        <CusteioLogo className="h-11 w-auto max-w-full text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
        <CusteioMark className="hidden h-8 w-8 group-data-[collapsible=icon]:block" />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
