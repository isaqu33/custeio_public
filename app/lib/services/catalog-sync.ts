import type { AnyBulkWriteOperation } from 'mongoose';
import { fetchAlloyCatalog } from '@/app/lib/alloy-client';
import { reserveAlloyRequest } from '@/app/lib/alloy-rate-limit';
import type { CatalogProduct } from '@/app/lib/alloy-catalog';
import connectDB from '@/app/lib/connect-db';
import { PermanentJobError } from '@/app/lib/jobs/errors';
import { appendJobLog } from '@/app/lib/jobs/log';
import { logger } from '@/app/lib/logger';
import { toObjectId } from '@/app/lib/mongo-id';
import { decryptSecret } from '@/app/lib/secret-encryption';
import PartnerProductDB from '@/app/models/partner-products';
import StoreDB from '@/app/models/stores';

export type CatalogSyncSummary = {
  products: number;
  activeProducts: number;
  created: number;
  updated: number;
  /** Known products Alloy no longer lists — kept, marked inactive. */
  deactivated: number;
  modifiers: number;
};

type RecipeLine = { rawIngredientId: unknown; quantity: number };
type KnownProduct = {
  externalId: string;
  modifiers?: Array<{ externalId: string; recipe?: RecipeLine[] }>;
};

const WRITE_CHUNK = 500;

// Retryable on purpose (a plain Error, not PermanentJobError): the quota frees
// up on its own within a minute, and the job's backoff (>= 65s, see the sync
// route) waits that out instead of hammering Alloy.
const QUOTA_MESSAGE =
  'A cota de requisições da Alloy desta loja se esgotou neste minuto; nova tentativa em cerca de 1 minuto.';

async function loadKnown(storeId: string) {
  const known = await PartnerProductDB.find({ storeId: toObjectId(storeId) })
    .select('externalId modifiers.externalId modifiers.recipe')
    .lean<KnownProduct[]>();
  return new Map(known.map((product) => [product.externalId, product]));
}

/**
 * The write half of the sync. Alloy owns name, price, category and the
 * complements; a person owns the recipes. So `recipe` is only ever set on
 * insert, and each complement gets its previous recipe back by external id —
 * overwriting the `modifiers` array as-is would silently erase them.
 */
async function applyCatalog(storeId: string, products: CatalogProduct[], now: Date) {
  const store = toObjectId(storeId);
  const known = await loadKnown(storeId);

  const operations: AnyBulkWriteOperation[] = products.map((product) => {
    const before = known.get(product.externalId);
    const recipes = new Map((before?.modifiers ?? []).map((m) => [m.externalId, m.recipe ?? []]));
    const unset: Record<string, ''> = {};
    if (product.promotionalPrice === undefined) unset.promotionalPrice = '';
    if (product.codPdv === undefined) unset.codPdv = '';

    return {
      updateOne: {
        filter: { storeId: store, externalId: product.externalId },
        update: {
          $set: {
            name: product.name,
            categoryName: product.categoryName,
            channel: product.channel,
            sellingPrice: product.price,
            isActive: product.isActive,
            lastSeenAt: now,
            ...(product.promotionalPrice !== undefined && {
              promotionalPrice: product.promotionalPrice,
            }),
            ...(product.codPdv !== undefined && { codPdv: product.codPdv }),
            modifiers: product.modifiers.map((modifier) => ({
              ...modifier,
              recipe: recipes.get(modifier.externalId) ?? [],
            })),
          },
          ...(Object.keys(unset).length > 0 && { $unset: unset }),
          $setOnInsert: { recipe: [] },
        },
        upsert: true,
      },
    };
  });

  for (let i = 0; i < operations.length; i += WRITE_CHUNK) {
    await PartnerProductDB.bulkWrite(operations.slice(i, i + WRITE_CHUNK), { ordered: false });
  }

  // An empty answer is far more likely a broken response than a store that
  // sells nothing: never let it switch the whole menu off.
  let deactivated = 0;
  if (products.length > 0) {
    const result = await PartnerProductDB.updateMany(
      {
        storeId: store,
        isActive: true,
        $or: [{ lastSeenAt: { $lt: now } }, { lastSeenAt: { $exists: false } }],
      },
      { $set: { isActive: false } },
    );
    deactivated = result.modifiedCount;
  }

  const created = products.filter((product) => !known.has(product.externalId)).length;
  return { created, updated: products.length - created, deactivated };
}

/** Records what Alloy told us about the store's token and quota, like the health check does. */
async function recordStoreOutcome(
  storeId: string,
  set: Record<string, unknown>,
  clearError: boolean,
) {
  await StoreDB.updateOne(
    { _id: toObjectId(storeId) },
    { $set: set, ...(clearError && { $unset: { lastError: '' } }) },
  );
}

type AlloyStoreCredentials = { name: string; apiKey: string };

/** The store's name and decrypted Alloy key, or a failure no retry can fix. */
async function loadAlloyCredentials(storeId: string): Promise<AlloyStoreCredentials> {
  const store = await StoreDB.findById(toObjectId(storeId))
    .select('name provider apiKey')
    .lean<{ name: string; provider?: string; apiKey?: string } | null>();
  if (!store) throw new PermanentJobError('Loja não encontrada.', 'store_not_found');
  if (store.provider !== 'alloy' || !store.apiKey) {
    throw new PermanentJobError(
      'Esta loja não tem a integração com a Alloy configurada.',
      'store_not_alloy',
    );
  }
  try {
    return { name: store.name, apiKey: decryptSecret(store.apiKey) };
  } catch {
    throw new PermanentJobError(
      'A chave de API salva não pôde ser lida; informe a chave novamente.',
      'store_key_unreadable',
    );
  }
}

type StepLogger = (name: string, message: string) => Promise<void>;
type FetchedCatalog = Extract<Awaited<ReturnType<typeof fetchAlloyCatalog>>, { kind: 'ok' }>;

/**
 * Turns anything but a good answer into the right kind of failure: the quota
 * (ours or Alloy's 429) and network errors are retryable, a refusal is not and
 * flags the store like the health check does.
 */
async function requireCatalog(
  storeId: string,
  result: Awaited<ReturnType<typeof fetchAlloyCatalog>>,
  step: StepLogger,
): Promise<FetchedCatalog> {
  if (result.kind === 'ok') return result;
  if (result.kind === 'rate_limited') {
    const numbers = {
      ...(result.rateLimitLimit !== undefined && { alloyRateLimitLimit: result.rateLimitLimit }),
      ...(result.rateLimitRemaining !== undefined && {
        alloyRateLimitRemaining: result.rateLimitRemaining,
      }),
    };
    await recordStoreOutcome(storeId, numbers, false);
    await step('alloy-quota', QUOTA_MESSAGE);
    throw new Error(QUOTA_MESSAGE);
  }
  if (result.kind === 'rejected') {
    await recordStoreOutcome(storeId, { status: 'error', lastError: result.message }, false);
    await step('alloy-rejected', `A Alloy recusou a consulta: ${result.message}`);
    throw new PermanentJobError(result.message, 'alloy_rejected');
  }
  await step('alloy-error', `Falha ao consultar a Alloy: ${result.message}`);
  throw new Error(result.message);
}

/**
 * "Sincronizar cardápio": ONE `getproducts` request (the whole menu — see
 * app/lib/alloy-catalog.ts) reserved against the store's 2 requests/minute Alloy
 * quota, then an upsert of `PartnerProducts` that leaves recipes alone.
 */
export async function syncCatalogForStore(
  storeId: string,
  context: { jobId: string },
): Promise<CatalogSyncSummary> {
  await connectDB();
  const log = logger.child({ correlationId: context.jobId, storeId, job: 'pos.catalog.sync' });
  const step: StepLogger = async (name, message) => {
    log.info({ step: name }, message);
    await appendJobLog(context.jobId, { step: name, message });
  };

  const { name, apiKey } = await loadAlloyCredentials(storeId);
  await step('sync-start', `Sincronização do cardápio iniciada para "${name}".`);

  // Every Alloy call for a store shares one budget (docs/features/alloy-api.md).
  if (!(await reserveAlloyRequest(storeId))) {
    await step('alloy-quota', QUOTA_MESSAGE);
    throw new Error(QUOTA_MESSAGE);
  }

  const catalog = await requireCatalog(storeId, await fetchAlloyCatalog({ apiKey }), step);
  const { products } = catalog;
  await step(
    'alloy-fetch',
    `Cardápio recebido da Alloy: ${products.length} produto(s) em uma única consulta.`,
  );

  const now = new Date();
  const applied = await applyCatalog(storeId, products, now);
  await recordStoreOutcome(
    storeId,
    {
      status: 'connected',
      lastSyncAt: now,
      ...(catalog.rateLimitLimit !== undefined && { alloyRateLimitLimit: catalog.rateLimitLimit }),
      ...(catalog.rateLimitRemaining !== undefined && {
        alloyRateLimitRemaining: catalog.rateLimitRemaining,
      }),
    },
    true,
  );

  const summary: CatalogSyncSummary = {
    products: products.length,
    activeProducts: products.filter((product) => product.isActive).length,
    modifiers: products.reduce((sum, product) => sum + product.modifiers.length, 0),
    ...applied,
  };
  if (products.length === 0) {
    await step(
      'catalog-empty',
      'A Alloy devolveu um cardápio vazio; nenhum produto foi desativado.',
    );
  }
  await step(
    'sync-done',
    `Sincronização concluída: ${summary.created} novo(s), ${summary.updated} atualizado(s), ${summary.deactivated} desativado(s) · ${summary.activeProducts} ativo(s) de ${summary.products} · ${summary.modifiers} complemento(s).`,
  );
  return summary;
}
