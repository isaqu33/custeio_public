import connectDB from '@/app/lib/connect-db';
import { ConflictError, NotFoundError } from '@/app/lib/errors';
import { INVITE_TOKEN_PATTERN, isInviteOpen } from '@/app/lib/invite';
import { hashPassword } from '@/app/lib/password-hashing';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import OrganizationDB from '@/app/models/organizations';
import UsersDB from '@/app/models/users';

// `onboarding` is the normal case. `active` stays claimable because an operator
// can activate an organization by hand before its owner signs up, or reissue an
// invite to an owner who lost access. `suspended` and `canceled` are not: an
// invite must not reopen an organization someone deliberately shut.
const CLAIMABLE_STATUSES: Array<'onboarding' | 'active'> = ['onboarding', 'active'];

/**
 * One message for every way a link can fail — wrong, revoked, already used or
 * expired. This endpoint is public, so telling those apart would let a stranger
 * probe which tokens once existed.
 */
export const INVALID_INVITE_MESSAGE = 'This invite link is invalid or has expired.';
export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists.';

export type ClaimableOrganization = { id: string; name: string };

/**
 * The organization a token can still claim, or `null` — unknown, expired, or
 * belonging to an organization that is suspended or canceled.
 */
export async function findClaimableOrganization(
  token: string,
): Promise<ClaimableOrganization | null> {
  // A token is 24 random bytes in hex. Anything else cannot match, so it never
  // reaches the query — which also keeps a crafted value out of the filter.
  if (!INVITE_TOKEN_PATTERN.test(token)) return null;

  await connectDB();
  const organization = await OrganizationDB.findOne({
    inviteToken: token,
    status: { $in: CLAIMABLE_STATUSES },
  })
    .select('name inviteExpiresAt')
    .lean<{ _id: { toString(): string }; name: string; inviteExpiresAt?: Date | null } | null>();
  if (!organization || !isInviteOpen(organization.inviteExpiresAt)) return null;

  return { id: organization._id.toString(), name: organization.name };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * The owner claims the account a salesperson set up: creates their own login,
 * linked to the organization, which graduates to `active`. The invite is
 * single-use.
 *
 * No transaction — the dev database is a standalone Mongo. Instead the user is
 * created first and the token is consumed atomically afterwards; if two people
 * race for one link, the loser's user is removed again. Consuming first would be
 * worse: a failure creating the user would burn the link.
 */
export async function claimInvite(input: {
  token: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ organizationId: string }> {
  const organization = await findClaimableOrganization(input.token);
  if (!organization) throw new NotFoundError(INVALID_INVITE_MESSAGE);

  if (await UsersDB.findOne({ email: input.email }).lean()) {
    throw new ConflictError(EMAIL_TAKEN_MESSAGE);
  }

  const password = await hashPassword(input.password);
  let userId: string;
  try {
    const user = await UsersDB.create({
      name: input.name,
      email: input.email,
      password,
      organizationIds: [organization.id],
      // The owner just chose this password, so there is nothing temporary to
      // rotate — unlike an account an operator created for someone.
      mustChangePassword: false,
    });
    userId = user._id.toString();
  } catch (err) {
    // The unique index on email is what actually settles a race that the
    // lookup above cannot.
    if (isDuplicateKeyError(err)) throw new ConflictError(EMAIL_TAKEN_MESSAGE);
    throw err;
  }

  const consumed = await OrganizationDB.findOneAndUpdate(
    { _id: organization.id, inviteToken: input.token, status: { $in: CLAIMABLE_STATUSES } },
    { $set: { status: 'active' }, $unset: { inviteToken: '', inviteExpiresAt: '' } },
  );
  if (!consumed) {
    await UsersDB.deleteOne({ _id: userId });
    throw new NotFoundError(INVALID_INVITE_MESSAGE);
  }

  await logAuditEvent({
    organizationId: organization.id,
    actorUserId: userId,
    action: 'organization.claim_invite',
    resourceType: 'organization',
    resourceId: organization.id,
    source: 'ui',
    message: 'Invite claimed.',
    metadata: { email: input.email },
  });

  return { organizationId: organization.id };
}
