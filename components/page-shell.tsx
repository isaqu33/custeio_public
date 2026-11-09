import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Same nav icon the sidebar entry uses for this page — a quick visual
          anchor breaking up what used to be plain stacked text, and a hook
          back to the page's place in the sidebar. */}
      {Icon ? (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

/**
 * Standard frame for protected pages: centered max-width column, page heading,
 * an optional actions slot aligned to the right, then the page body.
 *
 * Every protected page used to repeat this wrapper markup inline; keep new
 * pages on this component so spacing stays consistent.
 */
export function PageShell({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 flex-1 flex-col items-center">
      <div className="@container/main flex w-full min-w-0 max-w-[1400px] flex-1 flex-col gap-2">
        <div className="mt-3 flex min-w-0 flex-col gap-6 p-4 py-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <PageHeader title={title} description={description} icon={icon} />
            {actions ? <div className="w-full md:w-auto">{actions}</div> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
