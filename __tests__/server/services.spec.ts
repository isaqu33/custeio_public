/**
 * @jest-environment node
 */
export {};

const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();
// The jobs listing hides the platform CSV reports from a non-system session.
const sessionHasSystemAccessMock = jest.fn().mockResolvedValue(false);

const jobsCountDocumentsMock = jest.fn();
const jobsLeanMock = jest.fn();
const jobsLimitMock = jest.fn(() => ({ lean: jobsLeanMock }));
const jobsSkipMock = jest.fn(() => ({ limit: jobsLimitMock }));
const jobsSortMock = jest.fn(() => ({ skip: jobsSkipMock }));
const jobsSelectMock = jest.fn(() => ({ sort: jobsSortMock }));
const jobsFindMock = jest.fn(() => ({ select: jobsSelectMock }));

const organizationsCountDocumentsMock = jest.fn();
const organizationsLeanMock = jest.fn();
const organizationsLimitMock = jest.fn(() => ({ lean: organizationsLeanMock }));
const organizationsSkipMock = jest.fn(() => ({ limit: organizationsLimitMock }));
const organizationsSortMock = jest.fn(() => ({ skip: organizationsSkipMock }));
const organizationsSelectMock = jest.fn(() => ({ sort: organizationsSortMock }));
const organizationsFindMock = jest.fn(() => ({ select: organizationsSelectMock }));

jest.mock('@/app/lib/connect-db', () => ({
  __esModule: true,
  default: connectDBMock,
}));

jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
  sessionHasSystemAccess: sessionHasSystemAccessMock,
}));

jest.mock('@/app/models/jobs', () => ({
  __esModule: true,
  default: {
    find: jobsFindMock,
    countDocuments: jobsCountDocumentsMock,
  },
}));

jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: {
    find: organizationsFindMock,
    countDocuments: organizationsCountDocumentsMock,
  },
}));

describe('service layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    getAuthorizedOrganizationIdsMock.mockResolvedValue(['org-1']);

    jobsCountDocumentsMock.mockResolvedValue(1);
    jobsLeanMock.mockResolvedValue([
      {
        _id: 'job-1',
        organizationId: 'org-1',
        kind: 'users.export.csv',
      },
    ]);

    organizationsCountDocumentsMock.mockResolvedValue(1);
    organizationsLeanMock.mockResolvedValue([{ _id: 'org-1', name: 'Organization A' }]);
  });

  function lastJobsQuery() {
    const calls = jobsFindMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const lastCall = calls[calls.length - 1];
    if (!lastCall) throw new Error('expected jobs find call');
    return lastCall[0];
  }

  it('builds jobs list query with tenant, kind and dates', async () => {
    const { getJobsListForSession } = await import('@/app/lib/services/jobs');
    const session = { user: { id: 'u1' } } as never;
    sessionHasSystemAccessMock.mockResolvedValueOnce(true);

    const result = await getJobsListForSession(session, {
      page: 1,
      limit: 20,
      q: 'exam',
      kind: 'users.export.csv',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-28',
    });

    expect(result.done).toBe(true);
    expect(jobsFindMock).toHaveBeenCalledTimes(1);
    const query = lastJobsQuery();
    // System/Support looking at every organization also sees the platform jobs (no organization).
    expect(query.$and).toEqual([
      { $or: [{ organizationId: { $in: ['org-1'] } }, { organizationId: { $exists: false } }] },
    ]);
    expect(query.kind).toBe('users.export.csv');
    expect(query.createdAt).toBeDefined();
  });

  it('does not show the platform jobs (the runs of a cron) to a tenant listing', async () => {
    const { getJobsListForSession } = await import('@/app/lib/services/jobs');
    const session = { user: { id: 'u1' } } as never;
    sessionHasSystemAccessMock.mockResolvedValueOnce(false);

    await getJobsListForSession(session, { page: 1, limit: 20 });

    const query = lastJobsQuery();
    expect(query.organizationId).toEqual({ $in: ['org-1'] });
    expect(query.$and).toBeUndefined();
    const { SYSTEM_ONLY_JOB_KINDS } = await import('@/app/lib/jobs/system-only-kinds');
    expect(SYSTEM_ONLY_JOB_KINDS).toEqual(
      expect.arrayContaining(['cron.sefaz.auto-sync', 'cron.queue.cleanup']),
    );
    expect(query.kind).toEqual({ $nin: SYSTEM_ONLY_JOB_KINDS });
  });

  it('keeps the platform CSV reports out of a tenant listing', async () => {
    const { getJobsListForSession } = await import('@/app/lib/services/jobs');
    const { SYSTEM_ONLY_JOB_KINDS } = await import('@/app/lib/jobs/system-only-kinds');
    const session = { user: { id: 'u1' } } as never;

    // Those reports span every organization and are stamped with one arbitrary
    // org id, so tenant scoping alone would hand them to whichever tenant that
    // happened to be.
    await getJobsListForSession(session, { page: 1, limit: 20 });
    expect(lastJobsQuery().kind).toEqual({ $nin: SYSTEM_ONLY_JOB_KINDS });
  });

  it('matches nothing when a tenant filters by a report kind directly', async () => {
    const { getJobsListForSession } = await import('@/app/lib/services/jobs');
    const session = { user: { id: 'u1' } } as never;

    // Dropping the filter instead would widen the page to every other job.
    await getJobsListForSession(session, { page: 1, limit: 20, kind: 'users.export.csv' });
    expect(lastJobsQuery().kind).toEqual({ $in: [] });
  });

  it('scopes organization options to authorized organizations', async () => {
    const { getOrganizationOptionsForSession } = await import('@/app/lib/services/organizations');
    const session = { user: { id: 'u1' } } as never;

    const result = await getOrganizationOptionsForSession(session, { page: 1, limit: 250 });

    expect(result.done).toBe(true);
    expect(organizationsFindMock).toHaveBeenCalledWith({ _id: { $in: ['org-1'] } });
    expect(result.data[0]).toEqual({ _id: 'org-1', name: 'Organization A' });
  });
});
