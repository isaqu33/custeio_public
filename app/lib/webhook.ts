import crypto from 'node:crypto';
import { env } from './env';
import { logger } from './logger';

// Outbound completion notifications. When a caller submits an analysis with a
// `webhook` URL, RayAI POSTs to it once the job reaches a terminal state
// (success or definitive failure) so the caller doesn't have to poll. Delivery
// is signed (HMAC), retried with backoff, and best-effort (never throws).
const WEBHOOK_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;

export type WebhookStatus = 'success' | 'failed';

export type WebhookPayload = {
  jobId: string;
  status: WebhookStatus;
  timestamp: string;
  data?: unknown;
  error?: string;
};

// Outcome of a delivery attempt sequence, for the caller to record (jobs view).
export type WebhookDeliveryResult = {
  delivered: boolean;
  attempts: number;
  lastStatus: string; // HTTP status code or error description
};

// Allow only https (http only OUTSIDE production, for local/dev endpoints) and
// block loopback / private / link-local hosts. This mitigates SSRF — a tenant
// must not point the webhook at internal infrastructure — and keeps PHI (the
// report rides in the body) off cleartext http in production.
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && env.NODE_ENV === 'production') return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    const blocked = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^0\./,
      /^169\.254\./,
      /^localhost$/i,
      /^::1$/,
      /^\[::1\]$/,
    ];
    return !blocked.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// HMAC-SHA256 over `${timestamp}.${body}` so receivers can verify the call came
// from RayAI and bind the signature to the timestamp (replay mitigation). Returns
// null when no signing secret is configured.
function signBody(timestamp: string, body: string): string | null {
  const secret = env.APP_WEBHOOK_SIGNING_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// A 2xx is success; a 4xx other than 408/429 is a client-side problem a retry
// won't fix, so we stop. Timeouts, network errors and 5xx/408/429 are retried.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function attemptDelivery(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; retryable: boolean; status: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (res.ok) return { ok: true, retryable: false, status: String(res.status) };
    return { ok: false, retryable: isRetryableStatus(res.status), status: String(res.status) };
  } catch (err) {
    // Abort (timeout) or network error — both worth retrying.
    return {
      ok: false,
      retryable: true,
      status: err instanceof Error ? err.name : 'network-error',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort delivery with retry + backoff and an HMAC signature. Never throws;
// returns whether the endpoint acknowledged plus the attempt count / last status
// so the caller can record the outcome.
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.parse(payload.timestamp) / 1000) || 0);
  const signature = signBody(timestamp, body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'RayAI-Webhook/1.0',
    'X-RayAI-Timestamp': timestamp,
  };
  if (signature) headers['X-RayAI-Signature'] = `sha256=${signature}`;

  const maxAttempts = env.APP_WEBHOOK_MAX_RETRIES + 1;
  let lastStatus = 'no-attempt';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await attemptDelivery(url, body, headers);
    lastStatus = result.status;
    if (result.ok) return { delivered: true, attempts: attempt, lastStatus };
    if (!result.retryable || attempt === maxAttempts) {
      logger.warn({ url, status: lastStatus, attempt }, 'webhook delivery failed');
      return { delivered: false, attempts: attempt, lastStatus };
    }
    const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
    logger.warn({ url, status: lastStatus, attempt, backoff }, 'retrying webhook delivery');
    await delay(backoff);
  }
  return { delivered: false, attempts: maxAttempts, lastStatus };
}

export function sendSuccessWebhook(
  url: string,
  jobId: string,
  data?: unknown,
): Promise<WebhookDeliveryResult> {
  return sendWebhook(url, {
    jobId,
    status: 'success',
    timestamp: new Date().toISOString(),
    data,
  });
}

export function sendFailureWebhook(
  url: string,
  jobId: string,
  error: string,
): Promise<WebhookDeliveryResult> {
  return sendWebhook(url, {
    jobId,
    status: 'failed',
    timestamp: new Date().toISOString(),
    error,
  });
}
