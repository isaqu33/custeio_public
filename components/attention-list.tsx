import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AttentionItem, AttentionKind } from '@/app/lib/attention';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import { formatMoney } from '@/app/lib/quantity-format';
import { Card, CardContent } from '@/components/ui/card';

// Where each kind is handled: the page that shows the detail and lets the owner fix it.
const TARGET: Record<AttentionKind, string> = {
  missing_recipes: '/organization/orders',
  negative_stock: '/organization/stock',
  empty_preparations: '/organization/stock',
  no_cost: '/organization/stock',
  price_up: '/organization/prices',
  low_stock: '/organization/stock',
  drafts: '/organization/stock',
};

/** "Precisa da sua atenção": only what needs a decision, with the money involved when it is known. */
export function AttentionList({
  items,
  text,
  storeQuery,
}: {
  items: AttentionItem[];
  text: AppCopy['dashboard']['live'];
  /** `storeId=…&organizationId=…`, so each link opens the same store. */
  storeQuery: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{text.attentionTitle}</h2>
        <p className="text-sm text-muted-foreground">{text.attentionHint}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-600" />
          {text.allGood}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const copy = text.items[item.kind];
            return (
              <li key={item.kind}>
                <Card>
                  <CardContent className="flex items-start gap-3 py-4">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-medium">{copy.title}</span>
                      <p className="text-sm text-muted-foreground">
                        {formatCopy(copy.detail, {
                          count: item.count,
                          value: item.value === undefined ? '' : formatMoney(item.value),
                          examples: item.examples.join('; '),
                        })}
                      </p>
                    </div>
                    <Link
                      href={`${TARGET[item.kind]}?${storeQuery}`}
                      className="shrink-0 text-sm font-medium text-primary hover:underline"
                    >
                      {text.open}
                    </Link>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
