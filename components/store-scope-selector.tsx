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

export type StoreScopeOption = { id: string; name: string };

/**
 * Picks which store the Estoque page (and, later, any other per-loja screen)
 * reports on. Unlike `OrganizationScopeSelector`, there is no "all" option:
 * an ingredient always belongs to exactly one store, so the page always needs
 * one concrete `storeId` to create against.
 *
 * The selection lives in the URL as `storeId`. The fetch is narrowed by the
 * page's own `organizationId` (if the org scope bar above it has one set),
 * same composition `OrganizationWorkspaceFrame` + this selector give System
 * sessions on other pages.
 */
export function StoreScopeSelector({
  className,
  selectedStoreName,
}: {
  className?: string;
  selectedStoreName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy().rawIngredients;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState<StoreScopeOption[]>([]);

  const selectedId = searchParams.get('storeId') ?? '';
  const organizationId = searchParams.get('organizationId') ?? '';

  const sortedStores = useMemo(
    () => [...stores].sort((a, b) => a.name.localeCompare(b.name)),
    [stores],
  );

  // Only fetch while the popover is open: the list is a picker aid, not page
  // data (the page itself already resolved the selected store server-side).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const params = new URLSearchParams();
    if (organizationId) params.set('organizationId', organizationId);
    void apiFetch<{ done: boolean; data: Array<{ _id: string; name: string }> }>(
      `${endpointFor(AppFeature.ORGANIZATIONS_GET_STORE_OPTIONS)}?${params.toString()}`,
      { method: 'GET', cache: 'no-store' },
    )
      .then((result) => {
        if (cancelled) return;
        // The endpoint answers with `_id` (the Mongo id) — map it to `id` here
        // rather than widening `StoreScopeOption` to `_id`, so every other
        // reader of that type keeps the same shape `OrganizationScopeOption` uses.
        setStores(result.data.map((item) => ({ id: item._id, name: item.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, organizationId]);

  const selectedLabel =
    sortedStores.find((store) => store.id === selectedId)?.name ??
    selectedStoreName ??
    copy.storeLabel;

  const filteredStores = query
    ? sortedStores.filter((store) => store.name.toLowerCase().includes(query.toLowerCase()))
    : sortedStores;

  function select(nextId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('storeId', nextId);
    // A page or search from the previous store means nothing for this one.
    params.delete('page');
    params.delete('q');
    const search = params.toString();
    router.push(`${pathname}${search ? `?${search}` : ''}`);
    setOpen(false);
  }

  return (
    <div className={cn('relative flex w-full flex-col gap-1.5', className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {copy.storeLabel}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={copy.storeLabel}
            className="w-full justify-between text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-[340px] p-0 sm:w-[340px]">
          <Command>
            <CommandInput
              placeholder={copy.storeSearchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{copy.noStoreFound}</CommandEmpty>
              <CommandGroup>
                {filteredStores.map((store) => (
                  <CommandItem key={store.id} value={store.name} onSelect={() => select(store.id)}>
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        store.id === selectedId ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {store.name}
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
