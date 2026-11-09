import { formatDateTime } from '@/app/lib/outflow-format';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatMoney } from '@/app/lib/quantity-format';
import type { PriceReportView, PriceUnit } from '@/app/lib/services/price-report';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// A move this big is more often a pack or unit change on the invoice than a real price change.
const CHECK_UNIT_PERCENT = 50;

const dayOnly = (iso: string) => formatDateTime(iso).split(',')[0] ?? '';

/** The two tables of the Preços de compra page: price changes and the supplier comparison. */
export function PriceReportTables({
  report,
  text,
  hint,
  formatCost,
}: {
  report: PriceReportView;
  text: AppCopy['prices'];
  hint: string;
  formatCost: (value: number, unit: PriceUnit) => string;
}) {
  const supplier = (name: string) => name || text.manualSupplier;

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{text.changesTitle}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
        {report.changes.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {text.emptyChanges}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.columns.ingredient}</TableHead>
                <TableHead>{text.columns.supplier}</TableHead>
                <TableHead>{text.columns.before}</TableHead>
                <TableHead>{text.columns.now}</TableHead>
                <TableHead>{text.columns.change}</TableHead>
                <TableHead className="text-right">{text.columns.impact}</TableHead>
                <TableHead>{text.columns.date}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.changes.map((change) => (
                <TableRow key={`${change.ingredientId}-${change.supplierName}`}>
                  <TableCell className="font-medium">{change.name}</TableCell>
                  <TableCell className="max-w-48 truncate" title={supplier(change.supplierName)}>
                    {supplier(change.supplierName)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatCost(change.previous.unitCost, change.unit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatCost(change.latest.unitCost, change.unit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span
                      className={`tabular-nums font-semibold ${change.percent > 0 ? 'text-destructive' : 'text-emerald-600'}`}
                    >
                      {change.percent > 0 ? '+' : ''}
                      {change.percent.toFixed(1)}%
                    </span>
                    {Math.abs(change.percent) >= CHECK_UNIT_PERCENT ? (
                      <Badge
                        variant="outline"
                        className="ml-2 text-[10px] font-normal"
                        title={text.checkUnit}
                      >
                        {text.checkUnit}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${change.extraPaid > 0 ? 'text-destructive' : ''}`}
                  >
                    {change.extraPaid > 0 ? '+' : ''}
                    {formatMoney(change.extraPaid)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{dayOnly(change.latest.at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{text.comparisonTitle}</h2>
        <p className="text-sm text-muted-foreground">{text.comparisonHint}</p>
        {report.comparisons.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {text.emptyComparison}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.columns.ingredient}</TableHead>
                <TableHead>{text.columns.prices}</TableHead>
                <TableHead className="text-right">{text.columns.spread}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.comparisons.map((comparison) => (
                <TableRow key={comparison.ingredientId}>
                  <TableCell className="font-medium">{comparison.name}</TableCell>
                  <TableCell>
                    <ul className="flex flex-col gap-0.5 text-sm">
                      {comparison.prices.map((price, index) => (
                        <li key={price.supplierName} className="flex items-baseline gap-2">
                          <span className="tabular-nums font-semibold">
                            {formatCost(price.unitCost, comparison.unit)}
                          </span>
                          <span className="text-muted-foreground">
                            {supplier(price.supplierName)}
                          </span>
                          {index === 0 ? (
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              ↓
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    +{comparison.spreadPercent.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
