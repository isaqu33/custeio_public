import crypto from 'node:crypto';
import { env } from '@/app/lib/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

function getKey(): Buffer {
  const raw = env.APP_SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('APP_SECRETS_ENCRYPTION_KEY is not configured.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `APP_SECRETS_ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes (openssl rand -base64 32).`,
    );
  }
  return key;
}

/**
 * Encrypts a secret (e.g. a Store's Alloy `apiKey`) for storage at rest. Not a
 * one-way hash: the app needs the real value back to call the provider, so
 * this must be reversible. AES-256-GCM with a random IV per call; the result
 * packs IV + auth tag + ciphertext into one string so it fits a single
 * String column.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString('base64')).join('.');
}

/** Reverses {@link encryptSecret}. Throws if the key is missing/wrong or the
 * stored value was tampered with (GCM auth tag check fails). */
export function decryptSecret(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted secret.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
