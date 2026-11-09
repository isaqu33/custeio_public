#!/usr/bin/env node

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const pino = require('pino');

const logger = pino({ name: 'bootstrap-admin', level: process.env.APP_LOG_LEVEL || 'info' });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    logger.error({ env: name }, 'BOOTSTRAP BLOCKED: required environment variable is missing.');
    process.exit(1);
  }
  return value.trim();
}

function validatePassword(password) {
  if (password.length < 12) {
    logger.error('BOOTSTRAP BLOCKED: BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
}

async function main() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const email = requiredEnv('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = requiredEnv('BOOTSTRAP_ADMIN_PASSWORD');
  const name = requiredEnv('BOOTSTRAP_ADMIN_NAME');
  const confirmation = requiredEnv('BOOTSTRAP_ADMIN_CONFIRM');

  if (confirmation !== 'true') {
    logger.error('BOOTSTRAP BLOCKED: set BOOTSTRAP_ADMIN_CONFIRM=true to create the first admin.');
    process.exit(1);
  }

  validatePassword(password);

  await mongoose.connect(databaseUrl, {
    bufferCommands: false,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  });

  const users = mongoose.connection.collection('users');
  const existingUsers = await users.countDocuments({});
  if (existingUsers > 0) {
    logger.error(
      { existingUsers },
      'BOOTSTRAP BLOCKED: users already exist. This script only creates the first admin.',
    );
    process.exit(1);
  }

  const now = new Date();
  const hashedPassword = await bcrypt.hash(password, 10);

  await users.insertOne({
    name,
    email,
    password: hashedPassword,
    organizationIds: [],
    // Empty on purpose: `systemLevel: ['system']` is a bypass, so this account
    // reaches everything without belonging to a group. The Groups page seeds
    // itself on first open and the System group can then be assigned normally.
    groupIds: [],
    systemLevel: ['system'],
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
  });

  logger.info({ email }, 'Bootstrap admin created. Remove bootstrap env vars after first login.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'BOOTSTRAP FAILED.');
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
