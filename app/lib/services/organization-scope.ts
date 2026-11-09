import type { Session } from 'next-auth';
import { getAuthorizedOrganizationIds } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { toObjectIds } from '@/app/lib/mongo-id';
import OrganizationsDB from '@/app/models/organizations';

export type ScopedOrganization = {
  _id: string;
  name: string;
};

export type OrganizationScope = {
  /** Organization ids the request may touch, after narrowing. */
  ids: string[];
  /** The same organizations with their names, for columns and headings. */
  organizations: ScopedOrganization[];
};

/**
 * Resolves the organization scope bar into the set a request may act on.
 *
 * Shared by every page in the Organization group so the narrowing rule lives in
 * one place: the session's authorized organizations are the ceiling, and an
 * `organizationId` from the URL only ever narrows that set — it never widens it.
 * An unknown or unauthorized id resolves to an empty scope rather than to
 * "everything", which is the failure mode that matters in a multi-tenant app.
 */
export async function resolveOrganizationScope(
  session: Session,
  organizationId?: string,
): Promise<OrganizationScope> {
  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  if (!authorizedOrganizationIds.length) return { ids: [], organizations: [] };

  const ids =
    organizationId && organizationId !== 'all'
      ? authorizedOrganizationIds.filter((id) => id === organizationId)
      : authorizedOrganizationIds;
  if (!ids.length) return { ids: [], organizations: [] };

  const docs = await OrganizationsDB.find({ _id: { $in: toObjectIds(ids) } })
    .select('_id name')
    .sort({ name: 1 })
    .lean<{ _id: { toString(): string }; name?: string }[]>();

  return {
    ids,
    organizations: docs.map((doc) => ({ _id: doc._id.toString(), name: doc.name ?? '' })),
  };
}
