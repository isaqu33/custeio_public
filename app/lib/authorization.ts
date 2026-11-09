import type { Session } from 'next-auth';
import mongoose from 'mongoose';
import connectDB from './connect-db';
import { ForbiddenError, UnauthorizedError } from './errors';
import OrganizationDB from '../models/organizations';
import UsersDB from '../models/users';
import { hasHumanSystemAccess, type SystemLevel } from './system-levels';

/**
 * Every exported check here reads the database, so each one calls `connectDB()`
 * itself rather than trusting the caller.
 *
 * These run *before* the service that used to open the connection — a page guard
 * fires before it fetches anything, a route guard before it touches a model. With
 * `bufferCommands = false`, a query issued on a cold process throws
 * "Cannot call users.findOne() before initial connection is complete", which
 * surfaces as a 500 on the very first request after a restart and looks like a
 * broken login. `connectDB()` is cached, so the repeat calls cost nothing.
 */

type OrganizationId = string | mongoose.Types.ObjectId | { toString(): string };

type SessionWithUser = Session & {
  user: NonNullable<Session['user']> & { id: string };
};

type AuthorizationUser = {
  organizationIds?: OrganizationId[];
  systemLevel?: SystemLevel[];
  disabledAt?: Date | null;
};

function normalizeId(id: OrganizationId): string {
  return id.toString();
}

function hasSessionUserId(session: Session | null | undefined): session is SessionWithUser {
  return typeof session?.user?.id === 'string' && session.user.id.length > 0;
}

export function requireSessionUser(session: Session | null | undefined): SessionWithUser {
  if (!hasSessionUserId(session)) {
    throw new UnauthorizedError();
  }
  return session;
}

export async function getAuthorizedOrganizationIds(
  session: Session | null | undefined,
): Promise<string[]> {
  const sessionWithUser = requireSessionUser(session);
  await connectDB();
  const user = await UsersDB.findById(sessionWithUser.user.id)
    .select('organizationIds systemLevel disabledAt')
    .lean<AuthorizationUser | null>();

  // Sessions are stateless JWTs, so a deactivated account keeps a valid cookie
  // until it expires. This read happens on every authorized request anyway —
  // refusing here is what actually cuts an open session off.
  if (!user || user.disabledAt) {
    throw new UnauthorizedError();
  }

  if (hasSystemAccess(user)) {
    const organizations = await OrganizationDB.find({})
      .select('_id')
      .lean<{ _id: OrganizationId }[]>();
    return organizations.map((organization) => normalizeId(organization._id));
  }

  return (user.organizationIds ?? []).map(normalizeId);
}

async function userHasSystemAccess(userId: string): Promise<boolean> {
  await connectDB();
  const user = await UsersDB.findById(userId)
    .select('systemLevel disabledAt')
    .lean<AuthorizationUser | null>();
  if (!user || user.disabledAt) throw new UnauthorizedError();
  return hasSystemAccess(user);
}

function hasSystemAccess(user: AuthorizationUser): boolean {
  return hasHumanSystemAccess(user.systemLevel);
}

/**
 * Non-throwing System/Support check, for code that must shape a result rather
 * than reject the request. Returns false for an anonymous caller instead of
 * throwing, so it is safe to call while rendering.
 */
export async function sessionHasSystemAccess(
  session: Session | null | undefined,
): Promise<boolean> {
  if (!hasSessionUserId(session)) return false;
  return userHasSystemAccess(session.user.id);
}

/** Refuses anything but a System/Support session. */
export async function requireSystemAccess(session: Session | null | undefined): Promise<void> {
  const sessionWithUser = requireSessionUser(session);
  if (await userHasSystemAccess(sessionWithUser.user.id)) return;
  throw new ForbiddenError('You do not have system access.');
}

/**
 * Whether the session is System/Support, regardless of organization membership.
 *
 * Distinct from `getAuthorizedOrganizationIds(...).length > 0`: a System user on
 * a fresh install has no organizations yet but must still reach the app to
 * create the first one.
 */
export async function hasSystemLevelAccess(session: Session | null | undefined): Promise<boolean> {
  const sessionWithUser = requireSessionUser(session);
  return userHasSystemAccess(sessionWithUser.user.id);
}

export async function requireOrganizationAccess(
  session: Session | null | undefined,
  organizationId: string,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    throw new ForbiddenError('You do not have access to this organization.');
  }

  const allowedIds = await getAuthorizedOrganizationIds(session);
  if (!allowedIds.includes(organizationId)) {
    throw new ForbiddenError('You do not have access to this organization.');
  }
}

export async function requireSameUser(session: Session | null | undefined, userId: string) {
  const sessionWithUser = requireSessionUser(session);
  if (sessionWithUser.user.id !== userId) {
    throw new ForbiddenError('You can only update your own profile.');
  }
}

export async function requireUserManagementAccess(
  session: Session | null | undefined,
  targetUserId: string,
): Promise<void> {
  const sessionWithUser = requireSessionUser(session);
  if (await userHasSystemAccess(sessionWithUser.user.id)) return;
  if (sessionWithUser.user.id === targetUserId) return;

  const allowedOrganizationIds = await getAuthorizedOrganizationIds(sessionWithUser);
  await connectDB();
  const targetUser = await UsersDB.findById(targetUserId)
    .select('organizationIds')
    .lean<{ organizationIds?: OrganizationId[] } | null>();

  if (!targetUser) {
    throw new ForbiddenError('You do not have access to this user.');
  }

  const targetOrganizationIds = targetUser.organizationIds ?? [];

  // Orphan target (no organization yet — e.g. just created) is editable by
  // any admin: the listing already exposes them so we can assign tenants.
  if (targetOrganizationIds.length === 0) {
    return;
  }

  const hasSharedOrganization = targetOrganizationIds.some((id) =>
    allowedOrganizationIds.includes(normalizeId(id)),
  );

  if (!hasSharedOrganization) {
    throw new ForbiddenError('You do not have access to this user.');
  }
}
