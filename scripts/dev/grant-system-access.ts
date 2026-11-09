/**
 * Recovery hatch: grants an account the top `'system'` level.
 *
 * `'system'` is the one platform-wide bypass an operator can never newly grant
 * through the Users screen (see `app/lib/services/system-access.ts`) — so an
 * account that loses it cannot get it back through the UI, and if it was the
 * last System account, nobody can administer the install at all. This script
 * is the way out.
 *
 * Usage: npx tsx scripts/dev/grant-system-access.ts <email>
 */
import '../load-env';
import mongoose from 'mongoose';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('usage: npx tsx scripts/dev/grant-system-access.ts <email>');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  await mongoose.connect(databaseUrl);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db handle');

  const result = await db
    .collection('users')
    .updateOne({ email }, { $set: { systemLevel: ['system'] } });

  if (result.matchedCount === 0) {
    console.error(`No user with email ${email}.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const user = await db
    .collection('users')
    .findOne({ email }, { projection: { email: 1, systemLevel: 1 } });
  console.log(`System access restored for ${email}:`, JSON.stringify(user));
  await mongoose.disconnect();
}

void main();
