'use client';

import { useLinkStatus } from 'next/link';
import { cn } from '@/app/lib/utils';

/**
 * Fixed-size, non-layout-shifting dot rendered after a navigation label.
 *
 * It pulses while a Link navigation is pending, and stays lit on the entry that
 * owns the screen currently open, so the sidebar shows where you are. Kept in
 * layout at all times (opacity, not display) so toggling it never reflows the row.
 */
export function LinkLoadingHint({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      className={cn(
        'ml-auto size-1.5 shrink-0 rounded-full bg-current transition-opacity',
        pending || active ? 'opacity-100' : 'opacity-0',
        pending && 'animate-pulse',
        className,
      )}
    />
  );
}
