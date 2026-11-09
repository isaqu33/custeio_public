import type { Session } from 'next-auth';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { getAuthorizedOrganizationIds } from '@/app/lib/authorization';
import { containsCondition } from '@/app/lib/search-regex';
import connectDB from '@/app/lib/connect-db';
import { isInviteOpen } from '@/app/lib/invite';
import { totalPages } from '@/app/lib/pagination';
import OrganizationDB from '@/app/models/organizations';

export type OrganizationStatus = 'onboarding' | 'active' | 'suspended' | 'canceled';
export type BillingStatus = 'up_to_date' | 'past_due';

export type OrganizationsListResult = {
  done: boolean;
  data: Array<{
    _id: string;
    name: string;
    status: OrganizationStatus;
    billingStatus: BillingStatus;
    asaasCustomerId?: string;
    // Derived from `inviteToken` — never the token value itself, which isn't
    // safe to hand back on every list load the way a one-time reveal is.
    hasPendingInvite: boolean;
    createdAt: string;
  }>;
  total: number;
  page: number;
  totalPages: number;
};

export const NAME_SEARCH_FIELDS: readonly string[] = ['name'];

/** See the twin in services/users.ts — same contract, escaped term. */
function nameSearch(term: string, searchType?: string) {
  const condition = containsCondition(term.trim());
  if (searchType && NAME_SEARCH_FIELDS.includes(searchType)) {
    return { [searchType]: condition };
  }
  return { $or: NAME_SEARCH_FIELDS.map((field) => ({ [field]: condition })) };
}

export async function getOrganizationsListForSession(
  session: Session,
  params: { page?: number; limit?: number; q?: string; searchType?: string },
): Promise<OrganizationsListResult> {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);
  const q = params.q ?? '';
  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const query = q
    ? {
        _id: { $in: authorizedOrganizationIds },
        ...nameSearch(q, params.searchType),
      }
    : { _id: { $in: authorizedOrganizationIds } };
  const skip = (page - 1) * limit;

  const [organizations, total] = await Promise.all([
    OrganizationDB.find(query)
      .select('name status billingStatus asaasCustomerId inviteToken inviteExpiresAt createdAt')
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    OrganizationDB.countDocuments(query),
  ]);

  // `Date` fields come from mongoose .lean() as Date instances. `String(date)`
  // would produce a locale-dependent string ("Thu Jul 28 2026 ... GMT-0300")
  // that downstream consumers can't parse — serialize as ISO instead.
  const toIso = (value: unknown): string => {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    data: organizations.map((doc: LeanDoc) => ({
      _id: String(doc._id),
      name: String(doc.name ?? ''),
      status: (doc.status as OrganizationStatus) ?? 'onboarding',
      billingStatus: (doc.billingStatus as BillingStatus) ?? 'up_to_date',
      asaasCustomerId: doc.asaasCustomerId ? String(doc.asaasCustomerId) : undefined,
      // An expired invite no longer works, so it is offered for regeneration
      // rather than for viewing or revoking.
      hasPendingInvite:
        Boolean(doc.inviteToken) && isInviteOpen(doc.inviteExpiresAt as Date | null | undefined),
      createdAt: toIso(doc.createdAt),
    })),
    total,
    page,
    totalPages: totalPages(total, limit),
    done: true,
  };
}

export async function getOrganizationOptionsForSession(
  session: Session,
  params: { page?: number; limit?: number; q?: string },
) {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 250, 1000);
  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const skip = (page - 1) * limit;
  // The scope is the tenant boundary and is applied first; `q` only narrows what
  // is already visible to this session.
  const query = {
    _id: { $in: authorizedOrganizationIds },
    ...(params.q?.trim() ? { name: containsCondition(params.q.trim()) } : {}),
  };
  const [organizations, total] = await Promise.all([
    OrganizationDB.find(query).select('_id name').sort({ name: 1 }).skip(skip).limit(limit).lean(),
    OrganizationDB.countDocuments(query),
  ]);

  return {
    data: organizations.map((doc: LeanDoc) => ({
      _id: String(doc._id),
      name: String(doc.name ?? ''),
    })),
    total,
    page,
    totalPages: totalPages(total, limit),
    done: true,
  };
}

export async function getDefaultOrganizationForSession(session: Session) {
  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const organizations = await OrganizationDB.find({ _id: { $in: authorizedOrganizationIds } })
    .sort({ name: 1 })
    .limit(1)
    .lean();
  return {
    done: true,
    data: organizations.map((doc: LeanDoc) => ({
      _id: String(doc._id),
      name: String(doc.name ?? ''),
    })),
  };
}
