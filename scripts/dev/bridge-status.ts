/**
 * Read-only look at the webhook bridge (docs/features/webhook-bridge.md) next to the local
 * database: how many events the bridge holds, how many were already brought in, what became of
 * them, and whether a local Store matches the bridge's keys. Prints counts and event names only —
 * never a payload, a connection string or a key.
 *
 * Usage: npx tsx scripts/dev/bridge-status.ts
 */
import '../load-env';
import mongoose from 'mongoose';
import PosEventDB from '../../app/models/pos-events';
import StoreDB from '../../app/models/stores';

async function main() {
  const uri = process.env.BRIDGE_MONGODB_URI;
  if (!uri) throw new Error('BRIDGE_MONGODB_URI is not set.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const bridge = await mongoose
    .createConnection(uri, { dbName: process.env.BRIDGE_MONGODB_DB || 'bridge' })
    .asPromise();
  await mongoose.connect(process.env.DATABASE_URL);
  const events = bridge.collection('events');

  const total = await events.countDocuments();
  const unsynced = await events.countDocuments({ syncedAt: { $exists: false } });
  console.log(`bridge.events: ${total} total, ${unsynced} not synced yet`);

  const byResult = await events
    .aggregate([{ $group: { _id: { $ifNull: ['$syncResult', '(pending)'] }, n: { $sum: 1 } } }])
    .toArray();
  console.log('by syncResult:', Object.fromEntries(byResult.map((r) => [String(r._id), r.n])));

  const byEvent = await events
    .aggregate([{ $group: { _id: { $concat: ['$event', ' / status ', { $toString: '$payload.novo_status' }] }, n: { $sum: 1 } } }])
    .toArray();
  console.log('by event:', Object.fromEntries(byEvent.map((r) => [String(r._id), r.n])));

  const orders = await events.distinct('externalOrderId');
  console.log(`distinct orders: ${orders.length} (${orders.slice(0, 12).join(', ')}${orders.length > 12 ? ', …' : ''})`);

  const range = await events
    .aggregate([{ $group: { _id: null, first: { $min: '$receivedAt' }, last: { $max: '$receivedAt' } } }])
    .toArray();
  console.log('received between:', range[0]?.first?.toISOString?.(), '→', range[0]?.last?.toISOString?.());

  // Do the bridge's keys match a local Store? (hash only, never the key)
  const hashes = await events.distinct('keyHash');
  for (const hash of hashes) {
    const store = await StoreDB.findOne({ provider: 'alloy', webhookKeyHash: hash })
      .select('_id name')
      .lean<{ _id: unknown; name?: string } | null>();
    console.log(`key …${String(hash).slice(-6)} → ${store ? `Store ${String(store._id)} (${store.name ?? ''})` : 'NO local Store matches'}`);
  }

  const local = await PosEventDB.countDocuments({});
  const demo = await PosEventDB.countDocuments({ demo: true });
  console.log(`local pos_events: ${local} (${demo} demo)`);

  await bridge.close();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
