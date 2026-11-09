/**
 * Sets up the Alloy webhook identity of a Store: stores the SHA-256 of the "Chave" the
 * owner types in Alloy (Integrações → Webhooks) and, optionally, the store's Alloy id
 * (`loja_id`). With no `--key` a random one is generated and printed ONCE — paste it in
 * the Chave field. Only the hash is kept.
 *
 * Usage:
 *   npx tsx scripts/dev/set-store-webhook.ts --store <storeId> [--key <chave>] [--external-id 18424]
 */
import '../load-env';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { hashWebhookKey } from '../../app/lib/services/pos-events';
import StoreDB from '../../app/models/stores';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store <storeId> is required.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(process.env.DATABASE_URL);

  const key = arg('key') ?? crypto.randomBytes(24).toString('base64url');
  const externalId = arg('external-id');
  const result = await StoreDB.updateOne(
    { _id: storeId, provider: 'alloy' },
    { $set: { webhookKeyHash: hashWebhookKey(key), ...(externalId && { externalId }) } },
  );
  if (result.matchedCount === 0) throw new Error('Alloy store not found.');

  console.log(`webhook key set${externalId ? ` · externalId = ${externalId}` : ''}`);
  if (!arg('key')) console.log(`Chave (shown once): ${key}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
