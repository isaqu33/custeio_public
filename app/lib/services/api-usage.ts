import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import StoreDB from '@/app/models/stores';
import { getSefazUsageByStore, type SefazStoreUsage } from '@/app/lib/services/sefaz-requests';

export type ApiUsageSummary = {
  alloy: {
    storesConfigured: number;
    storesConnected: number;
    // Each Store has its own independent 2/min Alloy budget (see
    // docs/features/alloy-api.md) — summing them across stores would answer a
    // question nobody asked, so this shows the most recently checked store's
    // own numbers instead of a meaningless total.
    lastCheckedStoreName?: string;
    lastCheckedAt?: string;
    rateLimitLimit?: number;
    rateLimitRemaining?: number;
  };
  sefaz: {
    // Invoices *captured* (manual upload or SEFAZ) — a different thing from the
    // request counter below: one call can bring up to 50 documents.
    totalInvoicesCaptured: number;
    lastCapturedAt?: string;
    // Real `NFeDistribuicaoDFe` calls per Store over a sliding hour against the
    // 20/h per-CNPJ ceiling (docs/features/sefaz-nfe.md). Stores that never
    // called SEFAZ are omitted.
    stores: Array<{ storeName: string } & SefazStoreUsage>;
  };
};

/**
 * Rolls up Alloy connection/rate-limit and SEFAZ request/capture activity
 * across every Store an Organization has — the "how are we doing on API usage"
 * read behind the Organizations table's action. Both halves report only what
 * actually happened (a real health check, a real SEFAZ call, a real capture),
 * never an estimate.
 */
export async function getApiUsageSummaryForOrganization(
  organizationId: string,
): Promise<ApiUsageSummary> {
  await connectDB();

  const stores = await StoreDB.find({ organizationId: toObjectId(organizationId) })
    .select('name provider status lastHealthCheckAt alloyRateLimitLimit alloyRateLimitRemaining')
    .lean<
      Array<
        LeanDoc & {
          name: string;
          provider: string;
          status: string;
          lastHealthCheckAt?: Date;
          alloyRateLimitLimit?: number;
          alloyRateLimitRemaining?: number;
        }
      >
    >();

  const alloyStores = stores.filter((store) => store.provider === 'alloy');
  const mostRecentlyChecked = alloyStores
    .filter((store) => store.lastHealthCheckAt)
    .sort(
      (a, b) => (b.lastHealthCheckAt?.getTime() ?? 0) - (a.lastHealthCheckAt?.getTime() ?? 0),
    )[0];

  const storeIds = stores.map((store) => toObjectId(String(store._id)));
  const [totalInvoicesCaptured, mostRecentInvoice, sefazUsageByStore] = await Promise.all([
    ProcessedInvoiceDB.countDocuments({ storeId: { $in: storeIds } }),
    ProcessedInvoiceDB.findOne({ storeId: { $in: storeIds } })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean<{ createdAt?: Date } | null>(),
    getSefazUsageByStore(stores.map((store) => String(store._id))),
  ]);

  return {
    alloy: {
      storesConfigured: alloyStores.length,
      storesConnected: alloyStores.filter((store) => store.status === 'connected').length,
      lastCheckedStoreName: mostRecentlyChecked?.name,
      lastCheckedAt: mostRecentlyChecked?.lastHealthCheckAt?.toISOString(),
      rateLimitLimit: mostRecentlyChecked?.alloyRateLimitLimit,
      rateLimitRemaining: mostRecentlyChecked?.alloyRateLimitRemaining,
    },
    sefaz: {
      totalInvoicesCaptured,
      lastCapturedAt: mostRecentInvoice?.createdAt?.toISOString(),
      stores: stores.flatMap((store) => {
        const usage = sefazUsageByStore.get(String(store._id));
        return usage ? [{ storeName: store.name, ...usage }] : [];
      }),
    },
  };
}
