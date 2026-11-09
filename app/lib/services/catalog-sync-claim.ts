import connectDB from '@/app/lib/connect-db';
import { env } from '@/app/lib/env';
import { NotFoundError, TooManyRequestsError } from '@/app/lib/errors';
import { toObjectId } from '@/app/lib/mongo-id';
import StoreDB from '@/app/models/stores';

export type CatalogSyncAvailability = {
  lastSyncAt?: string;
  /** Set only while the button must stay disabled: when it may be pressed again. */
  nextAllowedAt?: string;
};

const cooldownMs = () => env.ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES * 60_000;

async function lastSyncOf(storeId: string): Promise<Date | undefined> {
  await connectDB();
  const store = await StoreDB.findById(toObjectId(storeId))
    .select('catalogLastSyncAt')
    .lean<{ catalogLastSyncAt?: Date } | null>();
  if (!store) throw new NotFoundError('Store not found.');
  return store.catalogLastSyncAt ?? undefined;
}

function nextAllowedAt(lastSyncAt: Date | undefined, now: Date): Date | undefined {
  if (!lastSyncAt) return undefined;
  const next = new Date(lastSyncAt.getTime() + cooldownMs());
  return next.getTime() > now.getTime() ? next : undefined;
}

/** What the Produtos page needs to label/disable "Sincronizar cardápio". Read-only. */
export async function getCatalogSyncAvailability(
  storeId: string,
  now: Date = new Date(),
): Promise<CatalogSyncAvailability> {
  const lastSyncAt = await lastSyncOf(storeId);
  const next = nextAllowedAt(lastSyncAt, now);
  return {
    lastSyncAt: lastSyncAt?.toISOString(),
    ...(next && { nextAllowedAt: next.toISOString() }),
  };
}

/**
 * Gate + claim in one step: 429 while the store is inside the cooldown,
 * otherwise stamps `catalogLastSyncAt` with a conditional update so two
 * simultaneous clicks cannot both win. The job still reserves its own request
 * from the store's per-minute Alloy budget; this only stops the button being
 * mashed.
 */
export async function claimCatalogSync(storeId: string, now: Date = new Date()): Promise<void> {
  const next = nextAllowedAt(await lastSyncOf(storeId), now);
  if (next) throw refusal(next, now);

  const threshold = new Date(now.getTime() - cooldownMs());
  const claimed = await StoreDB.findOneAndUpdate(
    {
      _id: toObjectId(storeId),
      $or: [
        { catalogLastSyncAt: { $exists: false } },
        { catalogLastSyncAt: null },
        { catalogLastSyncAt: { $lte: threshold } },
      ],
    },
    { $set: { catalogLastSyncAt: now } },
  ).lean();

  if (!claimed) {
    throw new TooManyRequestsError('A catalog sync for this store just started.');
  }
}

function refusal(next: Date, now: Date): TooManyRequestsError {
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  return new TooManyRequestsError(
    `A catalog sync for this store ran recently. Try again in ${minutes} min.`,
  );
}
