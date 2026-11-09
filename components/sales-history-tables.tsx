import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatMoney } from '@/app/lib/quantity-format';
import type { SalesHistory } from '@/app/lib/sales-history';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
};

const weekdayName = (weekday: number) =>
  // 2026-10-04 is a Sunday.
  new Date(Date.UTC(2026, 9, 4 + weekday)).toLocaleDateString('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC',
  });

/** The tables of the Vendas page: by day, best sellers and the average by weekday. */
export function SalesHistoryTables({
  history,
  text,
  channels,
}: {
  history: SalesHistory;
  text: AppCopy['sales'];
  channels: Record<string, string>;
}) {
  if (history.totals.orders === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
        <p className="text-sm font-medium">{text.empty}</p>
        <p className="text-sm text-muted-foreground">{text.emptyHint}</p>
      </div>
    );
  }
  const channelLabel = (channel: string) => channels[channel] ?? channel;
  const days = [...history.days].reverse().filter((day) => day.orders > 0);
  const weekdays = history.weekdays.filter((row) => row.dates > 0);

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{text.byDayTitle}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{text.columns.date}</TableHead>
              <TableHead>{text.columns.orders}</TableHead>
              <TableHead>{text.columns.items}</TableHead>
              <TableHead>{text.columns.channels}</TableHead>
              <TableHead className="text-right">{text.columns.revenue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.date}>
                <TableCell className="whitespace-nowrap font-medium capitalize">
                  {dayLabel(day.date)}
                </TableCell>
                <TableCell className="tabular-nums">{day.orders}</TableCell>
                <TableCell className="tabular-nums">{day.items}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {Object.entries(day.byChannel)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([channel, value]) => `${channelLabel(channel)} ${value.orders}`)
                    .join(' · ')}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(day.revenue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{text.productsTitle}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{text.columns.product}</TableHead>
              <TableHead>{text.columns.quantity}</TableHead>
              <TableHead>{text.columns.inOrders}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.products.map((product) => (
              <TableRow key={product.key}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="tabular-nums">{product.quantity}</TableCell>
                <TableCell className="tabular-nums">{product.orders}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{text.weekdaysTitle}</h2>
        <p className="text-sm text-muted-foreground">{text.weekdaysHint}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{text.columns.weekday}</TableHead>
              <TableHead>{text.columns.dates}</TableHead>
              <TableHead>{text.columns.avgOrders}</TableHead>
              <TableHead className="text-right">{text.columns.avgRevenue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weekdays.map((row) => (
              <TableRow key={row.weekday}>
                <TableCell className="capitalize">{weekdayName(row.weekday)}</TableCell>
                <TableCell className="tabular-nums">{row.dates}</TableCell>
                <TableCell className="tabular-nums">{row.avgOrders}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.avgRevenue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
