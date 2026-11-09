'use client';

import type { ReactNode } from 'react';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { useCopy } from '@/app/lib/i18n/client';

/**
 * The card every filtered listing sits in, above its `DataTableCard` (see
 * docs/design/data-tables.md) — same floating-card treatment, so the two
 * stack as one visual family instead of two differently-styled boxes. Kept as
 * three pieces so a page composes its own fields between the shell and the
 * action buttons.
 */
export function FilterShell({ children }: { children: ReactNode }) {
  return <Card className="mb-3 w-full p-4">{children}</Card>;
}

export function FilterRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-end [&>*]:min-w-0">
      {children}
    </div>
  );
}

/**
 * Apply and clear only. Refreshing a listing lives on the toolbar strip above
 * the table, where every listing in the app puts it — offering it here too is
 * what let the Analyses page end up with the button in a different place from
 * everywhere else.
 */
export function FilterActions({
  onApply,
  onClear,
  applyTitle,
  clearTitle,
}: {
  onApply: () => void;
  onClear?: () => void;
  applyTitle?: string;
  clearTitle?: string;
}) {
  const copy = useCopy();

  return (
    <div className="flex shrink-0 gap-2">
      <ActionButton
        action="filter"
        type="button"
        variant="default"
        size="icon"
        className="bg-primary text-white"
        title={applyTitle ?? copy.common.filter}
        iconOnly
        onClick={onApply}
      />
      {onClear ? (
        <ActionButton
          action="clear"
          type="button"
          variant="outline"
          size="icon"
          title={clearTitle ?? copy.common.clear}
          iconOnly
          onClick={onClear}
        />
      ) : null}
    </div>
  );
}
