'use client';

import { LogOutIcon, Maximize2, Minimize2, Moon, Settings, Sun } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { useUserSession } from '@/hooks/use-user-session';
import { useCopy } from '@/app/lib/i18n/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EditProfileModal } from './edit-profile-modal';
import { useUiDensity } from './ui-density';

/**
 * Account, theme, density and sign out — the gear icon in the header. Used to
 * live behind the sidebar footer's own name+email button; moved here so that
 * button can be a plain "who's signed in" line instead of doubling as a menu
 * trigger (see docs/design — the sidebar footer no longer opens anything).
 */
export function AccountMenuButton() {
  const copy = useCopy();
  const { resolvedTheme, setTheme } = useTheme();
  const { isCompact, toggleDensity } = useUiDensity();
  const { session, refetch } = useUserSession();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={(next) => setOpen(!session ? false : next)}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={copy.navigation.account}>
          <Settings className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 rounded-lg" align="end" sideOffset={4}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-lg">
              <AvatarImage src={session?.urlString} alt={session?.name} />
              <AvatarFallback className="rounded-lg">CN</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{session?.name}</span>
              <span className="truncate text-xs text-muted-foreground">{session?.email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <EditProfileModal
            userInfo={{
              email: session?.email,
              image: session?.image ?? session?.urlString,
              name: session?.name ?? '',
              _id: session?._id,
              language: session?.language,
            }}
            setCloseDropdownMenu={setOpen}
            setRefetchData={refetch}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {resolvedTheme === 'dark' ? copy.navigation.lightMode : copy.navigation.darkMode}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleDensity}>
          {isCompact ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
          {isCompact ? copy.navigation.comfortableMode : copy.navigation.compactMode}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })}>
          <LogOutIcon />
          {copy.navigation.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
