import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/app/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * The slim row of store-wide numbers above a table (Estoque, Produtos): icon,
 * label and value on one line, the longer explanation in a tooltip so the
 * table stays the focus. Server-renderable — no hooks.
 */
export function SummaryStrip({ children }: { children: ReactNode }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2">{children}</Card>
  );
}

export function SummaryStat({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs" title={hint}>
      <Icon className={cn('size-3.5 shrink-0', tone)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
