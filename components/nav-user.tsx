'use client';

import { useUserSession } from '@/hooks/use-user-session';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';

/**
 * Who is signed in — avatar, name, email. Plain display, nothing to click:
 * account, theme, density and sign out live in the header's gear menu
 * (`AccountMenuButton`) instead, so this row does not double as a hidden menu
 * trigger.
 */
export function NavUser() {
  const { session } = useUserSession();

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Avatar className="size-8 shrink-0 rounded-lg">
          <AvatarImage src={session?.urlString} alt={session?.name} />
          <AvatarFallback className="rounded-lg">CN</AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium">{session?.name}</span>
          <span className="truncate text-xs text-muted-foreground">{session?.email}</span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
