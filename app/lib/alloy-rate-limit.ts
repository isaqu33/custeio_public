import { rateLimit } from './rate-limit';

// Measured 2026-09-24 (docs/features/alloy-api.md): Alloy allows 2 requests per
// minute per *store token* — each Store has its own quota, the integrator token
// is not a shared bottleneck. Our own window is a fixed 60s bucket per store, so
// it can disagree with Alloy's at the edges; a 429 from Alloy is still handled.
const ALLOY_REQUESTS_PER_MINUTE_PER_STORE = 2;

/**
 * Reserves one Alloy request for `storeId`. Returns false when the store has
 * spent its quota for the current minute — the caller must not call Alloy.
 * Every Alloy call for a store (health check, catalog sync, order polling)
 * goes through here so they share one budget. Fails open if Redis is down.
 */
export async function reserveAlloyRequest(storeId: string): Promise<boolean> {
  const blocked = await rateLimit('alloy-store', storeId, ALLOY_REQUESTS_PER_MINUTE_PER_STORE);
  return !blocked;
}
