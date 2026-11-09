'use client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { getSidebarNavItems } from '@/components/app-sidebar-nav';
import { AccountMenuButton } from '@/components/account-menu-button';
import { Bell, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { useCopy, useLocale } from '@/app/lib/i18n/client';

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const copy = useCopy();
  const locale = useLocale();
  const [commandOpen, setCommandOpen] = React.useState(false);

  const segments = pathname.split('/').filter(Boolean);
  const section = segments[0] || 'home';
  const subsection = segments[1];

  // Keyed by route segment, so the breadcrumb label follows the active
  // dictionary. Unmapped segments fall back to the raw slug.
  const titleMap: Record<string, string> = {
    dashboard: copy.navigation.dashboard,
    users: copy.navigation.users,
    create: copy.navigation.create,
    update: copy.navigation.update,
    'audit-events': copy.navigation.auditEvents,
    organization: copy.navigation.organization,
    stock: copy.navigation.stock,
    products: copy.navigation.products,
    settings: copy.navigation.settings,
    system: copy.navigation.system,
    account: copy.navigation.account,
    jobs: copy.navigation.jobs,
    // `organization` means two different things depending on where it sits:
    // the tenant workspace at the root, the organizations list under System.
    // A full-path key wins over the bare segment so both read correctly.
    'system/organization': copy.navigation.organizations,
  };

  const labelFor = (segment: string, parent?: string) =>
    (parent ? titleMap[`${parent}/${segment}`] : undefined) ?? titleMap[segment] ?? segment;

  // Every destination, for the ⌘K palette. Access is enforced server-side on
  // each route, so listing them all here is safe — the same rule the sidebar
  // follows.
  const navGroups = React.useMemo(() => getSidebarNavItems(copy, locale), [copy, locale]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (url: string) => {
    setCommandOpen(false);
    router.push(url);
  };

  return (
    <header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <div className="flex h-5 items-center justify-center space-x-4 text-base font-medium">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/${section}`}>{labelFor(section)}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>

              {subsection && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink>{labelFor(subsection, section)}</BreadcrumbLink>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 truncate text-left">{copy.common.search}</span>
            <kbd className="pointer-events-none rounded border bg-background px-1.5 font-mono text-[10px] leading-5 text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-label={copy.common.search}
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" />
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label={copy.navigation.auditEvents}>
            <Link href="/system/audit-events">
              <Bell className="size-4" />
            </Link>
          </Button>
          <AccountMenuButton />
        </div>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder={copy.common.searchPlaceholder} />
        <CommandList>
          <CommandEmpty>{copy.common.noResultsFound}</CommandEmpty>
          {navGroups.map((group) => (
            <CommandGroup key={group.url} heading={group.title}>
              {(group.items ?? []).map((item) => (
                <CommandItem
                  key={item.url}
                  value={`${group.title} ${item.title}`}
                  onSelect={() => go(item.url)}
                >
                  {item.icon ? <item.icon className="mr-2 size-4" /> : null}
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}
