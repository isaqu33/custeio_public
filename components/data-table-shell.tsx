import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/app/lib/utils';

/**
 * The elevated-card shell every data table sits in — see
 * docs/design/data-tables.md for the pattern this codifies and why. Swaps the
 * shadcn/ui default `rounded-md border` box for the same floating Card the
 * sidebar and FilterShell already use, so a listing reads as one connected
 * product instead of an unstyled admin-template table.
 *
 * Composition: `DataTableCard` > `DataTableToolbar` (optional) > `<Table>` >
 * `DataTableFooter` (optional, pagination). `overflow-hidden` is what clips
 * the table's square header corners to the card's rounded ones.
 */
export function DataTableCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <Card className={cn('overflow-hidden', className)}>{children}</Card>;
}

/**
 * The toolbar row above `<Table>`: page-level filtering lives in `FilterShell`
 * above the card, so this is only for row-scoped actions — create, refresh —
 * which is why every caller today right-aligns it. Pass a className to
 * override if a future table needs something on the left.
 */
export function DataTableToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-b bg-muted/30 px-4 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The pagination row below `<Table>`, inside the same card. `total` is the
 * already-formatted record count ("Total: 152"); it sits to the left of the
 * page links so the count and the pages read as one control.
 */
export function DataTableFooter({ children, total }: { children: ReactNode; total?: string }) {
  if (!total) {
    return <div className="flex items-center justify-center border-t px-4 py-3">{children}</div>;
  }
  return (
    <div className="grid items-center gap-2 border-t px-4 py-3 sm:grid-cols-[1fr_auto_1fr]">
      <span className="text-center text-xs text-muted-foreground sm:text-left">{total}</span>
      <div className="flex justify-center">{children}</div>
      <span aria-hidden className="hidden sm:block" />
    </div>
  );
}
