'use client';

import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from './ui/button';
import { useCopy } from '@/app/lib/i18n/client';

export function SearchInput({ defaultValue }: { defaultValue?: string }) {
  const copy = useCopy();
  const [text, setText] = useState(defaultValue || '');
  const router = useRouter();
  // Captures what comes after the base URL (e.g. http://localhost:3000/clients?page=1 -> /clients)
  const pathname = usePathname();
  // Client Component hook that lets us read the current URL's search parameters (e.g. "page")
  const searchParams = useSearchParams();

  function navigate(params: URLSearchParams) {
    router.push(`${pathname}?${params.toString()}`);
  }

  async function submitFilter() {
    const params = new URLSearchParams(searchParams.toString());

    if (text) {
      params.set('q', text);
    } else {
      params.delete('q');
    }

    params.set('page', '1');
    navigate(params);
  }

  async function submitDeletedText() {
    if (!text) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    params.set('page', '1');
    setText('');
    navigate(params);
  }

  return (
    <div className="flex w-full flex-col items-stretch justify-between gap-2 md:flex-row md:items-end md:gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitFilter();
          }}
          placeholder={copy.common.searchPlaceholder}
          className="px-9"
        />
        {text && (
          <button
            type="button"
            aria-label={copy.common.clearSearch}
            onClick={submitDeletedText}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <Button
        variant="default"
        size="default"
        className="w-full bg-primary text-white md:w-auto"
        onClick={submitFilter}
      >
        {copy.common.filter}
      </Button>
    </div>
  );
}
