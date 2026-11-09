import type { Session } from 'next-auth';
import mongoose from 'mongoose';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { getAuthorizedOrganizationIds, sessionHasSystemAccess } from '@/app/lib/authorization';
import { isSystemOnlyJobKind, SYSTEM_ONLY_JOB_KINDS } from '@/app/lib/jobs/system-only-kinds';
import connectDB from '@/app/lib/connect-db';
import { escapeRegex } from '@/app/lib/search-regex';
import { totalPages } from '@/app/lib/pagination';
import JobsDB from '@/app/models/jobs';
import { endOfDay, startOfDay } from 'date-fns';
import type {
  JobDetail,
  JobErrorLog,
  JobListItem,
  JobProgress,
  JobStatus,
  JobStepLog,
  JobWebhookOutcome,
  JobsListSuccess,
} from '@/app/lib/types/jobs';

type JobsListParams = {
  page?: number;
  limit?: number;
  q?: string;
  /** Narrows the free-text search to one field; unset searches all four. */
  searchType?: string;
  kind?: string;
  organizationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

// Only the fields the listing table actually renders. Projecting this keeps the
// step logs, payload, progress and webhook data off the wire — the list can be
// large, and those nested fields belong to the detail view.
// `payload` rides along only so the row can say whether a study is downloadable
// and under what name — it is stripped in the mapping below, so the stored blob
// path never reaches the client.
const LIST_PROJECTION =
  'examId organizationId kind type status createdAt result payload.fileName payload.requestFileUrl';

function isScopedOrganizationId(organizationId?: string) {
  return Boolean(
    organizationId &&
    organizationId !== 'all' &&
    organizationId !== 'undefined' &&
    organizationId !== 'null',
  );
}

function buildCreatedAtFilter(params: JobsListParams) {
  const createdAtFilter: { $gte?: Date; $lte?: Date } = {};
  if (params.dateFrom) {
    const from = new Date(params.dateFrom);
    if (!Number.isNaN(from.getTime())) createdAtFilter.$gte = startOfDay(from);
  }
  if (params.dateTo) {
    const to = new Date(params.dateTo);
    if (!Number.isNaN(to.getTime())) createdAtFilter.$lte = endOfDay(to);
  }
  return createdAtFilter;
}

export const JOB_SEARCH_FIELDS: readonly string[] = ['examId', 'kind', 'type', 'status'];

// The platform-wide CSV reports are stamped with one arbitrary organization id, so tenant scoping alone
// would surface them to whichever clinic drew the short straw; the runs of a cron have no organization at
// all. Filtered here rather than in the page, so every caller of this service inherits the rule.
function hideSystemOnlyKinds(query: Record<string, unknown>, kind: string) {
  if (kind === 'all') {
    query.kind = { $nin: SYSTEM_ONLY_JOB_KINDS };
  } else if (isSystemOnlyJobKind(kind)) {
    // Asked for a report they may not see: match nothing, rather than drop the filter and silently
    // widen the page to everything else.
    query.kind = { $in: [] };
  }
}

// `organizationFilter` is already narrowed to authorized orgs by the caller
// (either a single ObjectId or `$in` over the authorized set).
function buildJobsQuery(
  organizationFilter: unknown,
  params: JobsListParams,
  hasSystemAccess: boolean,
  includePlatformJobs = false,
) {
  // Platform jobs (the runs of a cron) have no organization: a System/Support session looking at
  // every organization sees them too; picking one organization narrows to that organization's jobs.
  const query: Record<string, unknown> = includePlatformJobs
    ? {
        $and: [
          { $or: [{ organizationId: organizationFilter }, { organizationId: { $exists: false } }] },
        ],
      }
    : { organizationId: organizationFilter };

  const q = (params.q ?? '').trim();
  if (q) {
    const safeQ = escapeRegex(q);
    const condition = { $regex: safeQ, $options: 'i' };
    // Searching every field at once makes "done" match a status AND any examId
    // containing it. The picker beside the input narrows to one field; an
    // unknown/absent value keeps the old broad behavior.
    const searchType = params.searchType ?? '';
    if (JOB_SEARCH_FIELDS.includes(searchType)) {
      query[searchType] = condition;
    } else {
      query.$or = JOB_SEARCH_FIELDS.map((field) => ({ [field]: condition }));
    }
  }

  const kind = params.kind ?? 'all';
  if (kind !== 'all') query.kind = kind;
  if (!hasSystemAccess) hideSystemOnlyKinds(query, kind);

  const createdAtFilter = buildCreatedAtFilter(params);
  if (Object.keys(createdAtFilter).length > 0) query.createdAt = createdAtFilter;

  return query;
}

function mapJobListItem(doc: LeanDoc): JobListItem {
  const { payload, ...rest } = doc as LeanDoc & {
    payload?: { fileName?: string; requestFileUrl?: string };
  };
  return {
    ...rest,
    _id: String(doc._id),
    organizationId: doc.organizationId ? String(doc.organizationId) : '',
    errorLogs: doc.errorLogs ?? doc.errors ?? [],
    errors: doc.errorLogs ?? doc.errors ?? [],
    // Presence of the stored file, not the path to it: the row only needs to know
    // whether to offer the download, and what to call the file.
    hasStudy: Boolean(payload?.requestFileUrl),
    studyFileName: payload?.fileName ? String(payload.fileName) : undefined,
  } as JobListItem;
}

export async function getJobsListForSession(
  session: Session,
  params: JobsListParams,
): Promise<JobsListSuccess> {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);

  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const hasSystemAccess = await sessionHasSystemAccess(session);
  const skip = (page - 1) * limit;

  // Narrow to a single org when one is selected (and authorized), otherwise scope
  // to the full authorized set. Mongoose casts the string id(s) to ObjectId on
  // the query, so a single-org filter + the `createdAt` sort below ride the
  // `{ organizationId: 1, createdAt: -1 }` index for a fast, scan-free page.
  let organizationFilter: unknown;
  const allOrganizations = !isScopedOrganizationId(params.organizationId);
  if (!allOrganizations) {
    const orgId = `${params.organizationId}`;
    if (!authorizedOrganizationIds.includes(orgId)) {
      return { done: false, error: ApiErrorCode.FORBIDDEN };
    }
    if (!mongoose.Types.ObjectId.isValid(orgId)) {
      return { done: false, error: ApiErrorCode.INVALID_INPUT };
    }
    organizationFilter = orgId;
  } else {
    organizationFilter = { $in: authorizedOrganizationIds };
  }

  const query = buildJobsQuery(
    organizationFilter,
    params,
    hasSystemAccess,
    hasSystemAccess && allOrganizations,
  );

  const [jobs, total] = await Promise.all([
    JobsDB.find(query)
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobsDB.countDocuments(query),
  ]);

  return {
    done: true,
    data: jobs.map((doc: LeanDoc) => mapJobListItem(doc)),
    total,
    page,
    totalPages: totalPages(total, limit),
  };
}

type JobDetailLean = {
  _id: unknown;
  examId?: string;
  organizationId: unknown;
  kind?: string;
  type: string;
  status: JobStatus;
  createdAt: string | Date;
  updatedAt?: string | Date;
  webhook?: JobWebhookOutcome;
  logs?: JobStepLog[];
  errorLogs?: JobErrorLog[];
  errors?: JobErrorLog[];
  result?: Record<string, unknown>;
  progress?: JobProgress;
};

// A single job, scoped to the session's organizations. Returns null when the
// job doesn't exist or isn't visible to this user.
export async function getJobDetailForSession(
  session: Session,
  jobId: string,
): Promise<JobDetail | null> {
  if (!mongoose.isValidObjectId(jobId)) return null;

  await connectDB();
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  const hasSystemAccess = await sessionHasSystemAccess(session);
  const job = await JobsDB.findOne({
    _id: jobId,
    $or: [
      { organizationId: { $in: authorizedOrganizationIds } },
      // A platform job (the run of a cron) belongs to no organization.
      ...(hasSystemAccess ? [{ organizationId: { $exists: false } }] : []),
    ],
  }).lean<JobDetailLean | null>();
  if (!job) return null;

  // Same rule as the listing, repeated here because a row hidden from the table
  // is still fetchable by id. Reported as "not found" rather than "forbidden":
  // the caller has no business knowing the job exists.
  if (isSystemOnlyJobKind(job.kind) && !hasSystemAccess) return null;

  return {
    _id: String(job._id),
    examId: String(job.examId ?? ''),
    organizationId: job.organizationId ? String(job.organizationId) : '',
    kind: job.kind,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    webhook: job.webhook,
    logs: job.logs ?? [],
    errorLogs: job.errorLogs ?? job.errors ?? [],
    result: job.result ?? undefined,
    // Live counters/timings a job kind writes as it runs (e.g. `progress.nfe`).
    progress: job.progress ?? undefined,
    messages: [],
  };
}
