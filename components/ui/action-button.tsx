'use client';

import {
  CircleEllipsis,
  Download,
  Info,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRoundSearch,
  X,
} from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useCopy } from '@/app/lib/i18n/client';
import { cn } from '@/app/lib/utils';
import { Button } from './button';

// One glyph per action across the app. Add an entry here rather than importing a
// Lucide icon at a call site, so the same action never gets two different icons.
const actionConfig = {
  add: { copyKey: 'add', Icon: Plus },
  create: { copyKey: 'create', Icon: Plus },
  delete: { copyKey: 'delete', Icon: Trash2 },
  details: { copyKey: 'details', Icon: CircleEllipsis },
  download: { copyKey: 'download', Icon: Download },
  edit: { copyKey: 'edit', Icon: Pencil },
  filter: { copyKey: 'filter', Icon: Search },
  info: { copyKey: 'info', Icon: Info },
  inspect: { copyKey: 'inspect', Icon: UserRoundSearch },
  refresh: { copyKey: 'refresh', Icon: RefreshCw },
  reset: { copyKey: 'reset', Icon: KeyRound },
  clear: { copyKey: 'clear', Icon: X },
} as const;

type Action = keyof typeof actionConfig;

type ActionButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  action: Action;
  iconOnly?: boolean;
  label?: string;
};

/**
 * Shared button for repeated product actions.
 *
 * Use this instead of importing Lucide icons directly for add/create, edit,
 * delete, filter, clear and refresh so labels and glyphs stay aligned across
 * every admin table.
 */
export function ActionButton({
  action,
  iconOnly = false,
  label,
  className,
  title,
  children,
  ...props
}: ActionButtonProps) {
  const copy = useCopy();
  const { Icon, copyKey } = actionConfig[action];
  const defaultLabel = copy.common[copyKey];
  const resolvedLabel = label ?? defaultLabel;
  const accessibleLabel = title ?? resolvedLabel;

  return (
    <Button
      className={cn(
        // Circular ghost icon button — transparent until hover, brand-teal
        // fill on hover (--accent) — instead of the shadcn-default grid of
        // bordered squares every row/toolbar action used to be. The color
        // utilities here win over whatever `variant` passed in because they
        // come later in the className tailwind-merge resolves, so this holds
        // regardless of the `variant="outline"` every call site still passes.
        iconOnly &&
          'size-10 rounded-full border-transparent bg-transparent shadow-none hover:bg-accent hover:text-accent-foreground md:size-8',
        className,
      )}
      title={iconOnly ? accessibleLabel : title}
      aria-label={iconOnly ? accessibleLabel : undefined}
      {...props}
    >
      <Icon className={iconOnly ? 'size-4' : 'mr-2 size-4'} />
      {iconOnly ? null : (children ?? resolvedLabel)}
    </Button>
  );
}
