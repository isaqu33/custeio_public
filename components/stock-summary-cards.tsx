import { AlertTriangle, CalendarClock, Link2, Package, Receipt, Truck, Wallet } from 'lucide-react';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import type { StockSummary } from '@/app/lib/services/stock-summary';
import { SummaryStat, SummaryStrip } from '@/components/summary-strip';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * The store-wide numbers above the Estoque table. Server component: the page
 * hands it the already-computed summary, so a refresh after a capture (the
 * table calls `router.refresh()` when one finishes) updates them too.
 */
export function StockSummaryCards({
  summary,
  copy,
}: {
  summary: StockSummary;
  copy: AppCopy['rawIngredients']['summary'];
}) {
  return (
    <SummaryStrip>
      <SummaryStat
        icon={Wallet}
        tone="text-chart-1"
        label={copy.stockValue.label}
        value={formatCurrency(summary.stockValue)}
        hint={copy.stockValue.hint}
      />
      <SummaryStat
        icon={Package}
        tone="text-chart-2"
        label={copy.ingredients.label}
        value={String(summary.ingredients)}
        hint={formatCopy(copy.ingredients.hint, {
          drafts: summary.drafts,
          nonOperational: summary.nonOperational,
        })}
      />
      <SummaryStat
        icon={AlertTriangle}
        tone="text-chart-5"
        label={copy.alerts.label}
        value={String(summary.lowStock)}
        hint={formatCopy(copy.alerts.hint, { outOfStock: summary.outOfStock })}
      />
      <SummaryStat
        icon={Receipt}
        tone="text-chart-4"
        label={copy.invoices.label}
        value={String(summary.invoices)}
        hint={formatCopy(copy.invoices.hint, {
          value: formatCurrency(summary.invoicesTotalValue),
        })}
      />
      <SummaryStat
        icon={Truck}
        tone="text-chart-3"
        label={copy.suppliers.label}
        value={String(summary.suppliers)}
        hint={copy.suppliers.hint}
      />
      <SummaryStat
        icon={Link2}
        tone="text-chart-3"
        label={copy.mappedItems.label}
        value={String(summary.mappedItems)}
        hint={copy.mappedItems.hint}
      />
      <SummaryStat
        icon={CalendarClock}
        tone="text-chart-1"
        label={copy.lastInvoice.label}
        value={
          summary.lastInvoiceAt
            ? new Date(summary.lastInvoiceAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : copy.lastInvoice.none
        }
        hint={copy.lastInvoice.hint}
      />
    </SummaryStrip>
  );
}
