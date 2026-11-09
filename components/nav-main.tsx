'use client';

import { type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/app/lib/utils';
import { LinkLoadingHint } from '@/components/link-loading-hint';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: NavItem[];
};

// Active-page marker: a single, uniformly rounded pill (a rounded-square badge
// once the rail collapses to icons). Inactive rows sit back at reduced
// opacity so the open page leads.
const ACTIVE_MARKER = cn(
  'data-[active=true]:rounded-xl',
  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground',
  'data-[active=true]:hover:bg-sidebar-accent data-[active=true]:hover:text-sidebar-accent-foreground',
  'data-[active=true]:[&>svg]:text-sidebar-accent-foreground',
  'data-[active=false]:opacity-70 data-[active=false]:hover:opacity-100',
  'group-data-[collapsible=icon]:data-[active=true]:rounded-lg',
  'group-data-[collapsible=icon]:justify-center',
);

export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  // Prefix match, not equality, so a page stays lit on its own sub-pages
  // (`/system/chat-tester/medical-viewer` keeps Chat Tester active).
  const isActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`);

  // The loading hint only belongs on the entry that literally owns the open
  // screen, not on a parent that shares a URL prefix.
  const ownsCurrentScreen = (url: string) => pathname === url;

  // One flat, always-visible list per section — no accordion, no toggle. The
  // section label is a plain heading (it collapses away on the icon rail); every
  // page is a direct entry so it also shows as an icon when the rail is closed.
  return (
    <>
      {items.map((group) => (
        <SidebarGroup key={group.url}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(group.items ?? []).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={isActive(item.url)}
                    className={ACTIVE_MARKER}
                  >
                    <Link href={item.url}>
                      {item.icon && <item.icon />}
                      <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                      {/* A short bar rather than the component's default dot —
                          reads better as "you are here" next to a solid pill.
                          Hidden on the icon rail: left visible (just opacity 0
                          normally), its reserved width nudges the icon off
                          center in the cramped 32px button. */}
                      <LinkLoadingHint
                        active={ownsCurrentScreen(item.url)}
                        className="h-3.5 w-1 group-data-[collapsible=icon]:hidden"
                      />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
