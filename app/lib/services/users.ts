import type { Session } from 'next-auth';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { getAuthorizedOrganizationIds } from '@/app/lib/authorization';
import { containsCondition } from '@/app/lib/search-regex';
import connectDB from '@/app/lib/connect-db';
import { protectedAccountFilter } from '@/app/lib/protected-account';
import { totalPages } from '@/app/lib/pagination';
import { hasHumanSystemAccess, SYSTEM_LEVELS, type SystemLevel } from '@/app/lib/system-levels';
import { isUserStatusFilter, type UserStatusFilter } from '@/app/lib/user-status-filters';
import OrganizationDB from '@/app/models/organizations';
import UsersDB from '@/app/models/users';

export type UsersListResult = {
  done: boolean;
  data: Array<{
    _id: string;
    organizationIds: string[];
    name: string;
    email: string;
    organizationNames: string;
    hasSystemAccess: boolean;
    disabled: boolean;
    lastSignInAt?: string;
  }>;
  total: number;
  page: number;
  totalPages: number;
};

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// `null` matches both an explicit null and a missing field.
const STATUS_CONDITIONS: Record<UserStatusFilter, Record<string, unknown>> = {
  never_signed_in: { lastSignInAt: null },
  no_organization: { organizationIds: { $size: 0 } },
  system_access: { systemLevel: { $in: SYSTEM_LEVELS } },
  disabled: { disabledAt: { $ne: null } },
};

export const NAME_EMAIL_SEARCH_FIELDS: readonly string[] = ['name', 'email'];

/**
 * Free-text condition over name/email. The picker beside the input narrows it to
 * one field; anything else keeps the old both-fields behavior. The term is
 * escaped — it lands in a `$regex`.
 */
function nameEmailSearch(term: string, searchType?: string) {
  const condition = containsCondition(term.trim());
  if (searchType && NAME_EMAIL_SEARCH_FIELDS.includes(searchType)) {
    return { [searchType]: condition };
  }
  return { $or: NAME_EMAIL_SEARCH_FIELDS.map((field) => ({ [field]: condition })) };
}

export async function getUsersListForSession(
  session: Session,
  params: {
    page?: number;
    limit?: number;
    q?: string;
    searchType?: string;
    /** One organization, or absent / `'all'` for every one the session may see. */
    organizationId?: string;
    status?: string;
  },
): Promise<UsersListResult> {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);
  const q = params.q ?? '';

  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const tenantFilter = {
    $or: [
      { organizationIds: { $size: 0 } },
      { organizationIds: { $in: authorizedOrganizationIds } },
    ],
    // The platform bootstrap account is not a tenant user and must not be
    // administered from this screen — see app/lib/protected-account.ts.
    ...protectedAccountFilter(),
  };
  const conditions: Record<string, unknown>[] = [tenantFilter];
  if (q) conditions.push(nameEmailSearch(q, params.searchType));

  const requestedOrganizationId = params.organizationId;
  if (requestedOrganizationId && requestedOrganizationId !== 'all') {
    // Never trust the URL for tenancy: a filter may only narrow to an
    // organization the session is already authorized for. Anything else — a
    // malformed id or someone else's tenant — matches nobody instead of
    // silently widening back to the full list.
    if (!authorizedOrganizationIds.includes(requestedOrganizationId)) {
      return { data: [], total: 0, page, totalPages: totalPages(0, limit), done: true };
    }
    conditions.push({ organizationIds: requestedOrganizationId });
  }

  if (isUserStatusFilter(params.status)) {
    conditions.push(STATUS_CONDITIONS[params.status]);
  }

  const query = conditions.length === 1 ? tenantFilter : { $and: conditions };
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    UsersDB.find(query)
      .populate({
        path: 'organizationIds',
        model: OrganizationDB,
        select: 'name',
      })
      .select('name email organizationIds systemLevel lastSignInAt disabledAt')
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UsersDB.countDocuments(query),
  ]);

  return {
    data: users.map((doc: LeanDoc) => {
      const user = doc as {
        _id: unknown;
        name: string;
        email: string;
        systemLevel?: SystemLevel[];
        lastSignInAt?: unknown;
        disabledAt?: unknown;
      };
      // After `.populate('organizationIds')`, the field is an array of
      // partially-populated organization docs whose `_id` is still a Mongo
      // ObjectId. Server Components can't pass ObjectIds to Client
      // Components, so flatten to plain string ids + a joined display name.
      const organizations = doc.organizationIds as { _id?: unknown; name?: string }[] | undefined;
      return {
        _id: String(user._id),
        organizationIds: (organizations ?? []).map((e) => String(e._id ?? '')),
        name: user.name,
        email: user.email,
        organizationNames: organizations?.map((e) => e.name).join(', ') || 'No Organization',
        hasSystemAccess: hasHumanSystemAccess(user.systemLevel),
        disabled: Boolean(user.disabledAt),
        lastSignInAt: toIso(user.lastSignInAt),
      };
    }),
    total,
    page,
    totalPages: totalPages(total, limit),
    done: true,
  };
}
