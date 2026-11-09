'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { cn } from '@/app/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type OrganizationScopeOption = { id: string; name: string };

/**
 * Picks which organization the Organization pages report on: one, or all.
 *
 * The selection lives in the URL as `organizationId` (absent = all), which is
 * exactly what the dashboard, jobs and audit-events services already accept —
 * so choosing here filters all three without any per-page wiring.
 *
 * The sibling worklist's version is a *multi* selector (`organizationIds`, a
 * comma-separated list plus a `__none__` sentinel). Widening this to match means
 * teaching those three services to take a list; the single-or-all contract is
 * what they speak today.
 */
export function OrganizationScopeSelector({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [organizations, setOrganizations] = useState<OrganizationScopeOption[]>([]);

  const selectedId = searchParams.get('organizationId') ?? '';
  const allSelected = !selectedId || selectedId === 'all';

  const sortedOrganizations = useMemo(
    () => [...organizations].sort((a, b) => a.name.localeCompare(b.name)),
    [organizations],
  );

  // Only fetch while the popover is open: the list is a picker aid, not page
  // data, and every protected page mounts this frame.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ page: '1', limit: '50', q: query });
    void apiFetch<{ done: boolean; data: Array<{ _id: string; name: string }> }>(
      // The scoped endpoint, not `/api/organizations/list`: that one is
      // System/Support only, so every clinic user got a 403 here and an empty
      // dropdown. This one answers with the organizations the session may see.
      `${endpointFor(AppFeature.ORGANIZATIONS_GET_OPTIONS)}?${params.toString()}`,
      { method: 'GET', cache: 'no-store' },
    )
      .then((result) => {
        if (cancelled) return;
        setOrganizations(result.data.map((item) => ({ id: item._id, name: item.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  const selectedLabel = allSelected
    ? copy.organizationWorkspace.allOrganizations
    : (sortedOrganizations.find((organization) => organization.id === selectedId)?.name ??
      copy.organizationWorkspace.selectedFallback);

  function select(nextId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextId) params.set('organizationId', nextId);
    else params.delete('organizationId');
    // A narrower scope has fewer pages — staying on page 7 would show nothing.
    params.delete('page');
    const search = params.toString();
    router.push(`${pathname}${search ? `?${search}` : ''}`);
    setOpen(false);
  }

  return (
    <div className={cn('relative flex w-full flex-col gap-1.5', className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {copy.organizationWorkspace.selectorLabel}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={copy.organizationWorkspace.selectorLabel}
            className="w-full justify-between text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-[340px] p-0 sm:w-[340px]">
          <Command>
            <CommandInput
              placeholder={copy.organizationWorkspace.searchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{copy.organizationWorkspace.noOrganizationFound}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={copy.organizationWorkspace.allOrganizations}
                  onSelect={() => select(null)}
                >
                  <Check className={cn('mr-2 size-4', allSelected ? 'opacity-100' : 'opacity-0')} />
                  {copy.organizationWorkspace.allOrganizations}
                </CommandItem>
                {sortedOrganizations.map((organization) => (
                  <CommandItem
                    key={organization.id}
                    value={organization.name}
                    onSelect={() => select(organization.id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        organization.id === selectedId ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {organization.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
