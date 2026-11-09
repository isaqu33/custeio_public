import type { Session } from 'next-auth';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { getAuthorizedOrganizationIds } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { logger } from '@/app/lib/logger';
import { reserveAlloyRequest } from '@/app/lib/alloy-rate-limit';
import {
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  UnprocessableEntityError,
} from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { decryptSecret, encryptSecret } from '@/app/lib/secret-encryption';
import { testAlloyConnection, type AlloyConnectionTestResult } from '@/app/lib/alloy-client';
import StoreDB from '@/app/models/stores';

export type PosProvider = 'alloy' | 'consumer' | 'saipos' | 'grandchef' | 'anota_ai';
export type StoreStatus = 'connected' | 'error' | 'disconnected';

export type StoreListItem = {
  _id: string;
  cnpj: string;
  legalName?: string;
  name: string;
  whatsappNumber?: string;
  provider: PosProvider;
  externalId: string;
  // Never apiKey — write-only, never selected for a list or handed back to the client.
  imageUrl?: string;
  status: StoreStatus;
  lastHealthCheckAt?: string;
  lastError?: string;
  lastSyncAt?: string;
  // From Alloy's own `x-ratelimit-*` headers on the last health check — see
  // app/lib/alloy-client.ts. Undefined until the first check ever runs.
  alloyRateLimitLimit?: number;
  alloyRateLimitRemaining?: number;
  createdAt: string;
};

const LIST_FIELDS =
  'organizationId cnpj legalName name whatsappNumber provider externalId imageUrl status lastHealthCheckAt lastError lastSyncAt alloyRateLimitLimit alloyRateLimitRemaining createdAt';

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toListItem(doc: LeanDoc): StoreListItem {
  return {
    _id: String(doc._id),
    cnpj: String(doc.cnpj ?? ''),
    legalName: doc.legalName ? String(doc.legalName) : undefined,
    name: String(doc.name ?? ''),
    whatsappNumber: doc.whatsappNumber ? String(doc.whatsappNumber) : undefined,
    provider: doc.provider as PosProvider,
    externalId: String(doc.externalId ?? ''),
    imageUrl: doc.imageUrl ? String(doc.imageUrl) : undefined,
    status: (doc.status as StoreStatus) ?? 'disconnected',
    lastHealthCheckAt: toIso(doc.lastHealthCheckAt),
    lastError: doc.lastError ? String(doc.lastError) : undefined,
    lastSyncAt: toIso(doc.lastSyncAt),
    alloyRateLimitLimit:
      typeof doc.alloyRateLimitLimit === 'number' ? doc.alloyRateLimitLimit : undefined,
    alloyRateLimitRemaining:
      typeof doc.alloyRateLimitRemaining === 'number' ? doc.alloyRateLimitRemaining : undefined,
    createdAt: toIso(doc.createdAt) ?? '',
  };
}

// MongoServerError E11000 — thrown by the `cnpj` unique index when the same
// CNPJ is linked to a store twice.
function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

export async function getStoresForOrganization(organizationId: string): Promise<StoreListItem[]> {
  await connectDB();
  const stores = await StoreDB.find({ organizationId: toObjectId(organizationId) })
    .select(LIST_FIELDS)
    .sort({ createdAt: 1 })
    .lean();
  return stores.map((doc: LeanDoc) => toListItem(doc));
}

export type StoreOption = { _id: string; name: string; organizationId: string };

/**
 * The stores the signed-in session may work with — id, name and owning
 * organization only. Powers `StoreScopeSelector` the same way
 * `getOrganizationOptionsForSession` powers `OrganizationScopeSelector`: the
 * tenant boundary (authorized organization ids) is the answer, not a gate, so
 * a regular tenant session reaches this without System access — unlike
 * `getStoresForOrganization` above, which backs the System store table.
 */
export async function getStoreOptionsForSession(
  session: Session,
  params: { organizationId?: string } = {},
): Promise<StoreOption[]> {
  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);

  // A requested scope narrows to it only when the session is actually
  // authorized for it — same rule as every other reader of this URL param: an
  // unrecognized or unauthorized id matches nothing rather than silently
  // widening back to everything.
  const organizationIds =
    params.organizationId && params.organizationId !== 'all'
      ? authorizedOrganizationIds.filter((id) => id === params.organizationId)
      : authorizedOrganizationIds;

  if (organizationIds.length === 0) return [];

  const stores = await StoreDB.find({ organizationId: { $in: toObjectIds(organizationIds) } })
    .select('name organizationId')
    .sort({ name: 1 })
    .lean();

  return stores.map((doc: LeanDoc) => ({
    _id: String(doc._id),
    name: String(doc.name ?? ''),
    organizationId: String(doc.organizationId),
  }));
}

/** Resolves the owning organization of a store — routes need this to run the
 * authorization check before the caller-supplied `id` is trusted for anything. */
export async function getStoreOrganizationId(id: string): Promise<string | null> {
  await connectDB();
  const doc = await StoreDB.findById(toObjectId(id)).select('organizationId').lean();
  return doc ? String((doc as LeanDoc).organizationId) : null;
}

export async function createStoreForOrganization(input: {
  organizationId: string;
  cnpj: string;
  legalName?: string;
  name: string;
  whatsappNumber?: string;
  provider: PosProvider;
  externalId: string;
  apiKey?: string;
  imageUrl?: string;
}): Promise<StoreListItem> {
  await connectDB();
  try {
    const doc = await StoreDB.create({
      organizationId: toObjectId(input.organizationId),
      cnpj: input.cnpj,
      legalName: input.legalName,
      name: input.name,
      whatsappNumber: input.whatsappNumber,
      provider: input.provider,
      externalId: input.externalId,
      // Encrypted at rest — see app/lib/secret-encryption.ts. The provider
      // credential is only ever decrypted server-side when actually calling
      // the PDV API, never selected back for a list/client response.
      apiKey: input.apiKey ? encryptSecret(input.apiKey) : input.apiKey,
      imageUrl: input.imageUrl,
    });
    return toListItem(doc.toObject());
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('This CNPJ is already connected to a store.');
    }
    throw err;
  }
}

export async function updateStore(input: {
  id: string;
  legalName?: string;
  name?: string;
  whatsappNumber?: string;
  apiKey?: string;
  imageUrl?: string;
}): Promise<StoreListItem> {
  await connectDB();
  const doc = await StoreDB.findByIdAndUpdate(
    toObjectId(input.id),
    {
      $set: {
        ...(input.legalName !== undefined && { legalName: input.legalName }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.whatsappNumber !== undefined && { whatsappNumber: input.whatsappNumber }),
        // Omitted (not blank) leaves the stored key untouched — the client
        // never receives it back to resend. Encrypted at rest, same as create.
        ...(input.apiKey !== undefined && { apiKey: encryptSecret(input.apiKey) }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      },
    },
    { returnDocument: 'after' },
  )
    .select(LIST_FIELDS)
    .lean();

  if (!doc) throw new NotFoundError('Store not found.');
  return toListItem(doc);
}

/** Decrypts a store's PDV `apiKey` for an actual provider call (e.g. a future
 * `pos.catalog.sync`/`pos.order.received` job) — never for a list/client
 * response, which must keep using `getStoresForOrganization`. */
/** Decrypts a stored `apiKey`, turning any failure (value saved before
 * encryption existed, or encrypted under a different APP_SECRETS_ENCRYPTION_KEY)
 * into a 422 the UI can explain — the fix is always "re-enter the key". */
function decryptStoredApiKey(stored: unknown): string {
  try {
    return decryptSecret(String(stored));
  } catch (err) {
    logger.warn({ err }, 'stored store apiKey could not be decrypted');
    throw new UnprocessableEntityError('Stored API key is unreadable; re-enter it.');
  }
}

export async function getDecryptedStoreApiKey(id: string): Promise<string | null> {
  await connectDB();
  const doc = await StoreDB.findById(toObjectId(id)).select('apiKey').lean();
  const apiKey = doc ? (doc as LeanDoc).apiKey : undefined;
  return apiKey ? decryptStoredApiKey(apiKey) : null;
}

/** One budgeted Alloy call for a store, or a "not applicable" result. Throws
 * TooManyRequestsError — without touching the stored status — when the quota is
 * spent, either by our own per-store budget or by Alloy answering 429 (the
 * token is fine there, only the quota is gone). */
async function probeAlloyStore(id: string, store: LeanDoc): Promise<AlloyConnectionTestResult> {
  const apiKey = store.apiKey ? decryptStoredApiKey(store.apiKey) : null;
  if (store.provider !== 'alloy' || !apiKey) {
    return { ok: false, errorMessage: 'No Alloy API key configured for this store.' };
  }
  // The health check spends one of the store's 2 requests/minute like any
  // other Alloy call, so it must not run when the budget is already gone.
  if (!(await reserveAlloyRequest(id))) {
    throw new TooManyRequestsError('Alloy request budget for this store is spent.');
  }
  const result = await testAlloyConnection({ apiKey });
  if (result.rateLimited) {
    throw new TooManyRequestsError('Alloy rate limit reached for this store.');
  }
  return result;
}

/**
 * "Testar conexão" — one real Alloy call (see app/lib/alloy-client.ts),
 * recorded onto the store so both the connection status and the rate-limit
 * usage shown to an operator come from something Alloy actually said, not a
 * counter Custeio guessed at. Only meaningful for `provider: 'alloy'`
 * stores; called with anything else is a no-op that reports not-applicable
 * rather than erroring, since the action button doesn't hide itself yet.
 */
export async function runAlloyHealthCheck(id: string): Promise<StoreListItem> {
  await connectDB();
  const store = await StoreDB.findById(toObjectId(id)).select('provider apiKey').lean();
  if (!store) throw new NotFoundError('Store not found.');

  const result = await probeAlloyStore(id, store);
  const doc = await StoreDB.findByIdAndUpdate(
    toObjectId(id),
    {
      $set: {
        status: result.ok ? 'connected' : 'error',
        lastHealthCheckAt: new Date(),
        ...(!result.ok && { lastError: result.errorMessage ?? 'Unknown error' }),
        ...(result.rateLimitLimit !== undefined && { alloyRateLimitLimit: result.rateLimitLimit }),
        ...(result.rateLimitRemaining !== undefined && {
          alloyRateLimitRemaining: result.rateLimitRemaining,
        }),
      },
      ...(result.ok && { $unset: { lastError: '' } }),
    },
    { returnDocument: 'after' },
  )
    .select(LIST_FIELDS)
    .lean();

  if (!doc) throw new NotFoundError('Store not found.');
  return toListItem(doc);
}

export async function deleteStore(id: string): Promise<void> {
  await connectDB();
  const result = await StoreDB.deleteOne({ _id: toObjectId(id) });
  if (result.deletedCount === 0) throw new NotFoundError('Store not found.');
}
