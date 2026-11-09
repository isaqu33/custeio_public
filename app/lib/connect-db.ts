import mongoose from 'mongoose';
import { logger } from './logger';

type MongooseGlobal = {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
  listenersAttached: boolean;
};

const globalRef = global as typeof global & { mongoose?: MongooseGlobal };
const cached: MongooseGlobal =
  globalRef.mongoose ??
  (globalRef.mongoose = { conn: null, promise: null, listenersAttached: false });

// Wire connection-lifecycle events through the structured logger so transient
// drops are visible in log aggregation (instead of just showing up as a wave
// of generic query errors with no "connection lost" signal).
function attachLifecycleListeners(connection: mongoose.Connection) {
  if (cached.listenersAttached) return;
  cached.listenersAttached = true;
  connection.on('disconnected', () => {
    logger.warn('mongodb disconnected');
  });
  connection.on('reconnected', () => {
    logger.info('mongodb reconnected');
  });
  connection.on('error', (err) => {
    logger.error({ err }, 'mongodb connection error');
  });
}

async function connectDB() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error(
      'Please define the DATABASE_URL environment variable inside .env or .env.local',
    );
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose
      .connect(DATABASE_URL, opts)
      .then((mongooseInstance) => {
        logger.info({ database: mongooseInstance.connection.name }, 'connected to mongodb');
        attachLifecycleListeners(mongooseInstance.connection);
        return mongooseInstance.connection;
      })
      .catch((err) => {
        // Don't cache a rejected promise — otherwise every subsequent call
        // returns the same rejection and the app stays broken even after
        // Mongo comes back. Clearing it lets the next call retry.
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export default connectDB;
