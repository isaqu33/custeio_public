import { NextResponse } from 'next/server';
import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { env } from '@/app/lib/env';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservabilityOptions } from '@/app/lib/observability';
import { claimInvite } from '@/app/lib/services/organization-claim';
import { claimInvite as claimInviteSchema } from '@/app/lib/validations';

/**
 * PUBLIC — no session. The owner of a new organization redeems the invite link a
 * salesperson sent them and creates their own login.
 *
 * The invite token is the only credential, so this is held to a tight per-IP
 * rate limit (same budget as sign-in), answers every bad-link case with the same
 * 404, and never echoes the token back. Errors thrown by the service are typed
 * (`NotFoundError`, `ConflictError`) and mapped to their status by the wrapper.
 */
export const POST = withObservabilityOptions<{}>(
  AppFeature.ORGANIZATIONS_CLAIM_INVITE,
  async (req) => {
    const input = await parseRouteInput(req, claimInviteSchema);
    await claimInvite(input);

    return NextResponse.json(
      { done: true, message: 'Account created successfully.' },
      { status: HttpStatus.CREATED },
    );
  },
  { rateLimit: { limit: env.APP_RATE_LIMIT_CLAIM_PER_MIN, scope: 'claim' } },
);
