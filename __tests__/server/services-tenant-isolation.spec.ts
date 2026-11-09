/**
 * @jest-environment node
 */
export {};

const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();
// The jobs listing hides the platform CSV reports from a non-system session.
const sessionHasSystemAccessMock = jest.fn().mockResolvedValue(false);

const usersCountDocumentsMock = jest.fn();
const usersLeanMock = jest.fn();
const usersLimitMock = jest.fn(() => ({ lean: usersLeanMock }));
const usersSkipMock = jest.fn(() => ({ limit: usersLimitMock }));
const usersSortMock = jest.fn(() => ({ skip: usersSkipMock }));
const usersSelectMock = jest.fn(() => ({ sort: usersSortMock }));
const usersPopulateMock = jest.fn(() => ({ select: usersSelectMock }));
const usersFindMock = jest.fn(() => ({ populate: usersPopulateMock }));

const organizationsCountDocumentsMock = jest.fn();
const organizationsLeanMock = jest.fn();
const organizationsLimitMock = jest.fn(() => ({ lean: organizationsLeanMock }));
const organizationsSkipMock = jest.fn(() => ({ limit: organizationsLimitMock }));
const organizationsSortMock = jest.fn(() => ({ skip: organizationsSkipMock }));
const organizationsSelectMock = jest.fn(() => ({ sort: organizationsSortMock }));
const organizationsFindMock = jest.fn(() => ({ select: organizationsSelectMock }));

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
  sessionHasSystemAccess: sessionHasSystemAccessMock,
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { find: usersFindMock, countDocuments: usersCountDocumentsMock },
}));
jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: { find: organizationsFindMock, countDocuments: organizationsCountDocumentsMock },
}));

describe('service tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    getAuthorizedOrganizationIdsMock.mockResolvedValue(['org-1']);
    usersCountDocumentsMock.mockResolvedValue(0);
    usersLeanMock.mockResolvedValue([]);
    organizationsCountDocumentsMock.mockResolvedValue(0);
    organizationsLeanMock.mockResolvedValue([]);
  });

  it('users service always scopes query by authorized organization ids', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession({ user: { id: 'u1' } } as never, { page: 1, limit: 20 });
    const firstCallArg = (
      usersFindMock as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(0)?.[0];
    const query = (firstCallArg ?? {}) as Record<string, unknown> & {
      $or?: unknown[];
    };
    expect(query.$or).toBeDefined();
    expect(query.$or?.[1]).toEqual({ organizationIds: { $in: ['org-1'] } });
  });

  it('organizations options returns empty list when user has no authorized organizations', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValueOnce([]);
    const { getOrganizationOptionsForSession } = await import('@/app/lib/services/organizations');
    const result = await getOrganizationOptionsForSession({ user: { id: 'u1' } } as never, {});
    expect(organizationsFindMock).toHaveBeenCalledWith({ _id: { $in: [] } });
    expect(result.data).toEqual([]);
  });

  it('jobs service rejects cross-tenant organization filter', async () => {
    const { getJobsListForSession } = await import('@/app/lib/services/jobs');
    const result = await getJobsListForSession({ user: { id: 'u1' } } as never, {
      organizationId: 'org-999',
      page: 1,
      limit: 20,
    });
    expect(result.done).toBe(false);
    expect((result as { error?: string }).error).toBe('FORBIDDEN');
  });
});
