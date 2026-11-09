import mongoose from 'mongoose';
import { env } from '@/app/lib/env';

// One connection to the webhook bridge's MongoDB (docs/features/webhook-bridge.md), shared by the
// pull cron and the errors view. Separate from the app's own database connection.

let connection: Promise<mongoose.Connection> | undefined;

export const isBridgeConfigured = () => Boolean(env.BRIDGE_MONGODB_URI);

export function getBridgeConnection(): Promise<mongoose.Connection> {
  if (!env.BRIDGE_MONGODB_URI) throw new Error('BRIDGE_MONGODB_URI is not set');
  connection ??= mongoose
    .createConnection(env.BRIDGE_MONGODB_URI, {
      dbName: env.BRIDGE_MONGODB_DB,
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 2,
    })
    .asPromise();
  // A failed connect must not stay cached, or every later call would fail the same way.
  connection.catch(() => {
    connection = undefined;
  });
  return connection;
}
