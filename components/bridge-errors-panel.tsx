import type { ReactNode } from 'react';
import type { BridgeErrorsView } from '@/app/lib/services/bridge-errors';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Copy = {
  notConfigured: string;
  unavailable: string;
  allGood: string;
  quarantinedTitle: string;
  quarantinedHint: string;
  retrying: string;
  noStoreTitle: string;
  noStoreHint: string;
  rejectionsTitle: string;
  rejectionsHint: string;
  columns: Record<
    | 'receivedAt'
    | 'event'
    | 'order'
    | 'attempts'
    | 'error'
    | 'reason'
    | 'total'
    | 'last24h'
    | 'lastAt'
    | 'action',
    string
  >;
  reasons: Record<string, string>;
  reasonActions: Record<string, string>;
};

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

const when = (iso: string | undefined, locale: string) =>
  iso
    ? new Date(iso).toLocaleString(locale, {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
      })
    : '—';

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{props.title}</h2>
      {props.hint ? <p className="text-sm text-muted-foreground">{props.hint}</p> : null}
      {props.children}
    </section>
  );
}

/** System > POS events, "Bridge errors" view. Server component: the data is read on the server. */
export function BridgeErrorsPanel(props: { view: BridgeErrorsView; copy: Copy; locale: string }) {
  const { view, copy, locale } = props;

  if (!view.configured)
    return <p className="text-sm text-muted-foreground">{copy.notConfigured}</p>;
  if (view.unavailable) return <p className="text-sm text-destructive">{copy.unavailable}</p>;

  const nothing =
    view.quarantined.length === 0 &&
    view.retrying === 0 &&
    view.noStore.count === 0 &&
    view.rejections.length === 0;
  if (nothing) return <p className="text-sm text-muted-foreground">{copy.allGood}</p>;

  return (
    <div className="flex flex-col gap-8">
      {view.quarantined.length > 0 || view.retrying > 0 ? (
        <Section
          title={copy.quarantinedTitle}
          hint={fill(copy.quarantinedHint, { max: view.maxAttempts })}
        >
          {view.retrying > 0 ? (
            <p className="text-sm">{fill(copy.retrying, { count: view.retrying })}</p>
          ) : null}
          {view.quarantined.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.receivedAt}</TableHead>
                  <TableHead>{copy.columns.event}</TableHead>
                  <TableHead>{copy.columns.order}</TableHead>
                  <TableHead>{copy.columns.attempts}</TableHead>
                  <TableHead>{copy.columns.error}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.quarantined.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap">
                      {when(event.receivedAt, locale)}
                    </TableCell>
                    <TableCell>{event.event || '—'}</TableCell>
                    <TableCell>{event.orderRef ? `#${event.orderRef}` : '—'}</TableCell>
                    <TableCell>{event.attempts}</TableCell>
                    <TableCell className="max-w-md break-words text-destructive">
                      {event.error}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Section>
      ) : null}

      {view.noStore.count > 0 ? (
        <Section title={copy.noStoreTitle}>
          <p className="text-sm">
            {fill(copy.noStoreHint, {
              count: view.noStore.count,
              date: when(view.noStore.lastAt, locale),
            })}
          </p>
        </Section>
      ) : null}

      {view.rejections.length > 0 ? (
        <Section title={copy.rejectionsTitle} hint={copy.rejectionsHint}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.columns.reason}</TableHead>
                <TableHead>{copy.columns.total}</TableHead>
                <TableHead>{copy.columns.last24h}</TableHead>
                <TableHead>{copy.columns.lastAt}</TableHead>
                <TableHead>{copy.columns.action}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rejections.map((row) => (
                <TableRow key={row.reason}>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="outline">{copy.reasons[row.reason] ?? row.reason}</Badge>
                  </TableCell>
                  <TableCell>{row.total}</TableCell>
                  <TableCell>{row.last24h}</TableCell>
                  <TableCell className="whitespace-nowrap">{when(row.lastAt, locale)}</TableCell>
                  <TableCell className="max-w-md break-words text-sm">
                    {copy.reasonActions[row.reason] ?? ''}
                    {row.detail ? (
                      <span className="mt-1 block text-xs text-muted-foreground">{row.detail}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}
