/**
 * Manual probe of Alloy's `GET /api/delivery/getorders`: ONE request, saved raw
 * to a file and forgotten. Exists to learn the real order payload (items,
 * add-ons, dates) before modelling `Orders` — docs/features/alloy-api.md.
 *
 * The store's quota is 2 requests/minute, so it goes through `reserveAlloyRequest`
 * and never retries. Writes nothing to the database. The output holds customer
 * data: keep it out of git and sanitize before copying anything into docs.
 *
 * Usage:
 *   npx tsx scripts/dev/alloy-sample-orders.ts --store <storeId> --out <file.json> \
 *     [--status finalizado] [--query "data_atualizacao=2026-10-01"]
 *
 * Without --store it lists the Alloy stores and exits.
 */
import '../load-env';
import mongoose from 'mongoose';
import { writeFileSync } from 'node:fs';
import { env } from '../../app/lib/env';
import { reserveAlloyRequest } from '../../app/lib/alloy-rate-limit';
import { decryptSecret } from '../../app/lib/secret-encryption';
import StoreDB from '../../app/models/stores';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(env.DATABASE_URL);
  try {
    const storeId = arg('store');
    if (!storeId) {
      const stores = await StoreDB.find({ provider: 'alloy' }).select('name').lean();
      for (const s of stores) console.log(`${s._id}  ${s.name}`);
      return;
    }

    const out = arg('out');
    if (!out) throw new Error('--out <file.json> is required.');
    if (!env.ALLOY_INTEGRATOR_TOKEN || !env.ALLOY_API_HOST) {
      throw new Error('ALLOY_INTEGRATOR_TOKEN/ALLOY_API_HOST is not configured.');
    }

    const store = await StoreDB.findById(storeId).select('name apiKey').lean();
    if (!store?.apiKey) throw new Error('Store not found or without an Alloy key.');
    const apiKey = decryptSecret(store.apiKey);

    if (!(await reserveAlloyRequest(storeId))) {
      throw new Error('Store quota for this minute is spent; wait and run again.');
    }

    const params = new URLSearchParams(arg('query') ?? '');
    const status = arg('status') ?? 'finalizado';
    if (status !== 'none') params.set('status', status);
    const url = `https://api.${env.ALLOY_API_HOST}/api/${arg('path') ?? 'delivery/getorders'}?${params}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'integrador-token': env.ALLOY_INTEGRATOR_TOKEN,
      },
    });
    const text = await response.text();
    console.log(
      `HTTP ${response.status} · ${text.length} bytes · remaining ${response.headers.get('x-ratelimit-remaining')}`,
    );
    writeFileSync(out, text);
    console.log(`saved to ${out}`);
  } finally {
    await mongoose.disconnect();
  }
}

// Exit explicitly: the rate-limit helper leaves a Redis connection open.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
