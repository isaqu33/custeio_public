'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { FilterActions, FilterRow, FilterShell } from '@/components/filter-shell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFilterDraft } from '@/hooks/use-filter-draft';

export type SearchTypeOption = { value: string; label: string };

/**
 * The single-field search card shared by the listing screens, matching the
 * sibling worklist: an uppercase label, an optional field picker glued to the
 * input, and the apply/clear icon buttons.
 *
 * Pass `searchTypeOptions` only when the service actually narrows by field —
 * offering a picker the backend ignores would be a lie in the UI.
 */
export function SearchFilter({
  searchTerm,
  searchType,
  searchTypeOptions,
  searchTypeParam = 'searchType',
  label,
  placeholderField,
}: {
  searchTerm: string;
  searchType?: string;
  searchTypeOptions?: SearchTypeOption[];
  searchTypeParam?: string;
  label?: string;
  /** Fallback name for the "Search by {field}" placeholder when there is no picker. */
  placeholderField?: string;
}) {
  const copy = useCopy();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const firstOption = searchTypeOptions?.[0]?.value ?? '';
  // The URL owns the applied filter; this is the copy the user is editing.
  const { draft, setField } = useFilterDraft({
    text: searchTerm || '',
    type: searchType || firstOption,
  });

  const selectedLabel =
    searchTypeOptions?.find((option) => option.value === draft.type)?.label ??
    placeholderField ??
    copy.common.search;

  function push(next: { text: string; type: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const term = next.text.trim();
    if (term) params.set('q', term);
    else params.delete('q');
    if (term && searchTypeOptions?.length && next.type) params.set(searchTypeParam, next.type);
    else params.delete(searchTypeParam);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyFilters() {
    push(draft);
  }

  function clearFilters() {
    // No local reset: dropping the params makes the server send the unfiltered
    // listing back, and the draft resyncs to whatever is actually applied.
    push({ text: '', type: firstOption });
  }

  return (
    <FilterShell>
      <FilterRow>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label ?? copy.common.search}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-0">
            {searchTypeOptions?.length ? (
              <Select value={draft.type} onValueChange={(value) => setField('type', value)}>
                <SelectTrigger aria-label={copy.common.searchField} className="w-full sm:w-[180px]">
                  <SelectValue placeholder={copy.common.searchField} />
                </SelectTrigger>
                <SelectContent>
                  {searchTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Input
              value={draft.text}
              onChange={(event) => setField('text', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
              placeholder={formatCopy(copy.common.searchBy, { field: selectedLabel })}
              className="w-full min-w-0 sm:flex-1"
            />
          </div>
        </div>
        <FilterActions onApply={applyFilters} onClear={clearFilters} />
      </FilterRow>
    </FilterShell>
  );
}
