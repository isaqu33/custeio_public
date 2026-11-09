import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatDateTime } from '@/app/lib/outflow-format';
import { formatMoney, formatQuantity } from '@/app/lib/quantity-format';
import type { WasteSummary } from '@/app/lib/services/internal-use';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Unit = 'g' | 'ml' | 'un';

/** The Avarias view: what was lost in the month in R$ at cost, per reason and per ingredient. */
export function WasteView({
  summary,
  text,
}: {
  summary: WasteSummary;
  text: AppCopy['internalUse'];
}) {
  const waste = text.waste;
  const reasonLabel = (reason: string) =>
    (waste.reasons as Record<string, string>)[reason] ?? reason;
  const cards = [
    { ...waste.summary.total, value: formatMoney(summary.totalValue) },
    { ...waste.summary.entries, value: String(summary.rows.length) },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.label} title={card.hint}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {summary.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-center">
          <p className="text-sm font-medium">{waste.empty}</p>
          <p className="text-sm text-muted-foreground">{waste.emptyHint}</p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{waste.byReasonTitle}</h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              {summary.byReason.map((row) => (
                <li key={row.reason} className="rounded-md border px-3 py-1.5">
                  <span className="text-muted-foreground">{reasonLabel(row.reason)}: </span>
                  <span className="font-semibold tabular-nums">{formatMoney(row.totalValue)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{waste.byIngredientTitle}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{text.columns.ingredient}</TableHead>
                  <TableHead>{text.columns.quantity}</TableHead>
                  <TableHead className="text-right">{waste.columns.lost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byIngredient.map((row) => (
                  <TableRow key={row.ingredientName}>
                    <TableCell className="font-medium">{row.ingredientName}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatQuantity(row.quantity, row.unit as Unit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(row.totalValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{waste.entriesTitle}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{text.columns.when}</TableHead>
                  <TableHead>{text.columns.reason}</TableHead>
                  <TableHead>{text.columns.ingredient}</TableHead>
                  <TableHead>{text.columns.quantity}</TableHead>
                  <TableHead className="text-right">{waste.columns.lost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(row.occurredAt)}
                    </TableCell>
                    <TableCell>{reasonLabel(row.reason)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.ingredientName}</span>
                        {row.note ? (
                          <span className="text-xs text-muted-foreground">{row.note}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatQuantity(row.quantity, row.unit as Unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </>
  );
}
