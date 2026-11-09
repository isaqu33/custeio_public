'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gauge, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { formatDateShortUtc, formatTimeShortUtc } from '@/app/lib/date-format';
import { formatCopy } from '@/app/lib/i18n/format';
import { showApiErrorToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import type { ApiUsageSummary } from '@/app/lib/services/api-usage';

function timestamp(value?: string) {
  if (!value) return undefined;
  return `${formatDateShortUtc(value)} ${formatTimeShortUtc(value)}`;
}

/**
 * "How are we doing on API usage" for one Organization — Alloy connection +
 * rate-limit window, and SEFAZ capture activity. See
 * app/lib/services/api-usage.ts for why these are honest-but-different
 * shapes: Alloy has a real per-store quota to report, SEFAZ (manual upload
 * only today) does not, so it reports real capture activity instead of a
 * fabricated quota.
 */
export default function ModalOrganizationApiUsage({ id }: { id: string }) {
  const copy = useCopy().system.organizations.apiUsage;
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ApiUsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiFetch<{ done: boolean; data: ApiUsageSummary }>(
        endpointFor(AppFeature.ORGANIZATIONS_GET_API_USAGE),
        { method: 'POST', body: { organizationId: id }, cache: 'no-store' },
      );
      setSummary(result.data);
    } catch (error) {
      setLoadError(copy.loadFailed);
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    } finally {
      setIsLoading(false);
    }
  }, [id, copy.loadFailed]);

  useEffect(() => {
    if (!open) return;
    // Async — the setState calls run after an await, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.open}
        >
          <Gauge className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {copy.loading}
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{loadError}</p>
        ) : summary ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {copy.alloyTitle}
              </p>
              <p className="mt-1 text-sm">
                {formatCopy(copy.alloyStoresConnected, {
                  connected: summary.alloy.storesConnected,
                  total: summary.alloy.storesConfigured,
                })}
              </p>
              {summary.alloy.rateLimitLimit !== undefined &&
              summary.alloy.rateLimitRemaining !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {formatCopy(copy.alloyRateLimit, {
                    used: summary.alloy.rateLimitLimit - summary.alloy.rateLimitRemaining,
                    limit: summary.alloy.rateLimitLimit,
                    store: summary.alloy.lastCheckedStoreName ?? '',
                  })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{copy.alloyNoChecks}</p>
              )}
              {summary.alloy.lastCheckedAt ? (
                <p className="text-xs text-muted-foreground">
                  {formatCopy(copy.lastCheckedAt, { time: timestamp(summary.alloy.lastCheckedAt) })}
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {copy.sefazTitle}
              </p>
              {summary.sefaz.stores.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{copy.sefazNoRequests}</p>
              ) : (
                summary.sefaz.stores.map((store) => (
                  <div key={store.storeName} className="mt-1 text-sm">
                    <p>
                      {formatCopy(copy.sefazRequests, {
                        store: store.storeName,
                        used: store.production.usedLastHour,
                        limit: store.production.limit,
                      })}
                    </p>
                    {store.homologation.usedLastHour > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {formatCopy(copy.sefazRequestsHomologation, {
                          used: store.homologation.usedLastHour,
                          limit: store.homologation.limit,
                        })}
                      </p>
                    ) : null}
                    {store.production.blockedUntil || store.homologation.blockedUntil ? (
                      <p className="text-xs font-medium text-destructive">
                        {formatCopy(copy.sefazBlockedUntil, {
                          time: timestamp(
                            store.production.blockedUntil ?? store.homologation.blockedUntil,
                          ),
                        })}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatCopy(copy.sefazLastRequest, {
                        time: timestamp(store.lastRequestAt),
                        cStat: store.lastCStat,
                        env:
                          store.lastTpAmb === 1
                            ? copy.sefazEnvProduction
                            : copy.sefazEnvHomologation,
                      })}
                    </p>
                  </div>
                ))
              )}
              <p className="mt-2 text-sm">
                {formatCopy(copy.sefazCaptured, { count: summary.sefaz.totalInvoicesCaptured })}
              </p>
              {summary.sefaz.lastCapturedAt ? (
                <p className="text-xs text-muted-foreground">
                  {formatCopy(copy.lastCapturedAt, {
                    time: timestamp(summary.sefaz.lastCapturedAt),
                  })}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">{copy.sefazHint}</p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
