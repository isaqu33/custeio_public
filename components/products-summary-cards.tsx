import { CalendarClock, ChefHat, PackageCheck, Percent, Tag } from 'lucide-react';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import type { ProductsSummary } from '@/app/lib/services/products';
import { SummaryStat, SummaryStrip } from '@/components/summary-strip';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * The store-wide numbers above the Produtos table: computed over the whole
 * store (a search or page does not change them), refreshed with the page after
 * a sync or a recipe save. Server component.
 */
export function ProductsSummaryCards({
  summary,
  copy,
}: {
  summary: ProductsSummary;
  copy: AppCopy['products']['summary'];
}) {
  return (
    <SummaryStrip>
      <SummaryStat
        icon={PackageCheck}
        tone="text-chart-1"
        label={copy.activeProducts.label}
        value={String(summary.activeProducts)}
        hint={formatCopy(copy.activeProducts.hint, { inactive: summary.inactiveProducts })}
      />
      <SummaryStat
        icon={ChefHat}
        tone="text-chart-2"
        label={copy.withRecipe.label}
        value={String(summary.withRecipe)}
        hint={formatCopy(copy.withRecipe.hint, { without: summary.withoutRecipe })}
      />
      <SummaryStat
        icon={Tag}
        tone="text-chart-4"
        label={copy.averagePrice.label}
        value={formatCurrency(summary.averagePrice)}
        hint={copy.averagePrice.hint}
      />
      <SummaryStat
        icon={Percent}
        tone="text-chart-5"
        label={copy.averageMargin.label}
        value={
          summary.averageMarginPercent === undefined
            ? copy.averageMargin.none
            : `${summary.averageMarginPercent.toFixed(1).replace('.', ',')}%`
        }
        hint={copy.averageMargin.hint}
      />
      <SummaryStat
        icon={CalendarClock}
        tone="text-chart-3"
        label={copy.lastSync.label}
        value={
          summary.lastSeenAt
            ? new Date(summary.lastSeenAt).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'America/Sao_Paulo',
              })
            : copy.lastSync.none
        }
        hint={copy.lastSync.hint}
      />
    </SummaryStrip>
  );
}
