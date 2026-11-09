import type { Session } from 'next-auth';
import { getAuthorizedOrganizationIds } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { totalPages } from '@/app/lib/pagination';
import AuditEventsDB from '@/app/models/audit-events';
import UsersDB from '@/app/models/users';

import type { AuditEventOutcome, AuditEventSource } from './audit-log';

// The writer lives in `audit-log.ts` (see the note there); re-exported so the many
// callers that already import it from here keep working.
export type { AuditEventInput, AuditEventOutcome, AuditEventSource } from './audit-log';
export { logAuditEvent } from './audit-log';

export type AuditEventListItem = {
  _id: string;
  organizationId: string;
  organizationName: string;
  actorName: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  source: AuditEventSource;
  outcome: AuditEventOutcome;
  message: string;
  createdAt: string;
};

export type AuditEventsListResult = {
  done: boolean;
  data: AuditEventListItem[];
  total: number;
  page: number;
  totalPages: number;
  actions: string[];
};

type LeanAuditEvent = {
  _id: { toString(): string };
  organizationId?: { toString(): string } | null;
  actorUserId?: { toString(): string } | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  source: AuditEventSource;
  outcome: AuditEventOutcome;
  message?: string;
  createdAt: Date;
};

function dateRangeFilter(dateFrom?: string, dateTo?: string) {
  const createdAt: Record<string, Date> = {};
  // The inputs are plain dates (yyyy-mm-dd); widen `to` to the end of the day so
  // "from 10th to 10th" returns that whole day rather than nothing.
  if (dateFrom) createdAt.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
  if (dateTo) createdAt.$lte = new Date(`${dateTo}T23:59:59.999Z`);
  return Object.keys(createdAt).length ? createdAt : undefined;
}

/**
 * Lists audit events the session is allowed to see, newest first.
 *
 * Always constrained to `getAuthorizedOrganizationIds` — an `organizationId`
 * coming from the client narrows that set, it never widens it.
 */
export async function listAuditEventsForSession(
  session: Session,
  params: {
    page?: number;
    limit?: number;
    organizationId?: string;
    action?: string;
    actor?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<AuditEventsListResult> {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);

  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  if (!authorizedOrganizationIds.length) {
    return { done: true, data: [], total: 0, page, totalPages: 0, actions: [] };
  }

  const scopedIds =
    params.organizationId && params.organizationId !== 'all'
      ? authorizedOrganizationIds.filter((id) => id === params.organizationId)
      : authorizedOrganizationIds;
  if (!scopedIds.length) {
    return { done: true, data: [], total: 0, page, totalPages: 0, actions: [] };
  }

  const query: Record<string, unknown> = { organizationId: { $in: toObjectIds(scopedIds) } };

  const createdAt = dateRangeFilter(params.dateFrom, params.dateTo);
  if (createdAt) query.createdAt = createdAt;
  if (params.action && params.action !== 'all') query.action = params.action;

  // Actor is free text over the user's name/email, so it has to resolve to ids
  // first — the event itself only stores the reference.
  const actorTerm = params.actor?.trim();
  if (actorTerm) {
    const actors = await UsersDB.find({
      $or: [
        { name: { $regex: actorTerm, $options: 'i' } },
        { email: { $regex: actorTerm, $options: 'i' } },
      ],
    })
      .select('_id')
      .lean<{ _id: { toString(): string } }[]>();
    if (!actors.length) {
      return { done: true, data: [], total: 0, page, totalPages: 0, actions: [] };
    }
    query.actorUserId = { $in: actors.map((actor) => toObjectId(actor._id.toString())) };
  }

  const skip = (page - 1) * limit;
  const [rows, total, actions] = await Promise.all([
    AuditEventsDB.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actorUserId', 'name email')
      .populate('organizationId', 'name')
      .lean(),
    AuditEventsDB.countDocuments(query),
    // Feeds the action filter. Scoped to what the session may see so the dropdown
    // never leaks the existence of an action from another tenant.
    AuditEventsDB.distinct('action', { organizationId: { $in: toObjectIds(scopedIds) } }),
  ]);

  const data = (
    rows as unknown as (LeanAuditEvent & {
      actorUserId?: { _id: unknown; name?: string; email?: string } | null;
      organizationId?: { _id: unknown; name?: string } | null;
    })[]
  ).map((row) => ({
    _id: row._id.toString(),
    organizationId: row.organizationId?._id?.toString() ?? '',
    organizationName: row.organizationId?.name ?? '',
    actorName: row.actorUserId?.name ?? '',
    actorEmail: row.actorUserId?.email ?? '',
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? '',
    source: row.source,
    outcome: row.outcome,
    message: row.message ?? '',
    createdAt: new Date(row.createdAt).toISOString(),
  }));

  return {
    done: true,
    data,
    total,
    page,
    totalPages: totalPages(total, limit),
    actions: actions.sort(),
  };
}
