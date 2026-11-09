/**
 * @jest-environment node
 */
export {};

// The Users screen's filters. What matters most is the tenancy rule: the
// organization comes from the URL, so it may only ever narrow the list to a
// tenant the session is already authorized for.
const getAuthorizedOrganizationIdsMock = jest.fn();
const connectDBMock = jest.fn();
const protectedAccountFilterMock = jest.fn();
const countDocumentsMock = jest.fn();
const findMock = jest.fn();

jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
}));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/protected-account', () => ({
  protectedAccountFilter: protectedAccountFilterMock,
}));
jest.mock('@/app/models/organizations', () => ({ __esModule: true, default: {} }));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { find: findMock, countDocuments: countDocumentsMock },
}));

const ORG_A = '665f735a90788d97f5a76322';
const ORG_B = '665f735a90788d97f5a76333';
const session = { user: { id: 'admin-1' }, expires: '' } as never;

function queryChain(rows: unknown[]) {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
  return chain;
}

function lastQuery(): Record<string, unknown> {
  return findMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('getUsersListForSession filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A, ORG_B]);
    connectDBMock.mockResolvedValue(undefined);
    protectedAccountFilterMock.mockReturnValue({});
    findMock.mockReturnValue(queryChain([]));
    countDocumentsMock.mockResolvedValue(0);
  });

  it('applies no extra condition when no filter is given', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, {});

    // Just the tenant scope — no `$and` wrapper around a single condition.
    expect(Object.keys(lastQuery())).not.toContain('$and');
    expect(lastQuery()).toHaveProperty('$or');
  });

  it("treats organizationId 'all' as no organization filter", async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, { organizationId: 'all' });

    expect(Object.keys(lastQuery())).not.toContain('$and');
  });

  it('narrows to one organization the session is authorized for', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, { organizationId: ORG_A });

    const conditions = (lastQuery().$and as Record<string, unknown>[]) ?? [];
    expect(conditions).toContainEqual({ organizationIds: ORG_A });
  });

  it('matches nobody — and never queries — for an organization the session cannot see', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    const result = await getUsersListForSession(session, {
      organizationId: '665f735a90788d97f5a76999',
    });

    expect(result).toMatchObject({ done: true, data: [], total: 0 });
    expect(findMock).not.toHaveBeenCalled();
  });

  it('matches nobody for a malformed organization id instead of widening the list', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    const result = await getUsersListForSession(session, { organizationId: '{"$ne":null}' });

    expect(result.data).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it.each([
    ['never_signed_in', { lastSignInAt: null }],
    ['no_organization', { organizationIds: { $size: 0 } }],
    ['system_access', { systemLevel: { $in: ['system', 'support'] } }],
    ['disabled', { disabledAt: { $ne: null } }],
  ])('filters by situation %s', async (status, expected) => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, { status });

    const conditions = (lastQuery().$and as Record<string, unknown>[]) ?? [];
    expect(conditions).toContainEqual(expected);
  });

  it('ignores a situation that is not on the whitelist', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, { status: 'anything-else' });

    expect(Object.keys(lastQuery())).not.toContain('$and');
  });

  it('combines organization, situation and text search', async () => {
    const { getUsersListForSession } = await import('@/app/lib/services/users');
    await getUsersListForSession(session, {
      organizationId: ORG_B,
      status: 'disabled',
      q: 'ze',
      searchType: 'name',
    });

    const conditions = (lastQuery().$and as Record<string, unknown>[]) ?? [];
    // tenant scope + search + organization + situation
    expect(conditions).toHaveLength(4);
  });

  it('reports the deactivated flag on each row', async () => {
    findMock.mockReturnValue(
      queryChain([
        {
          _id: 'u1',
          name: 'Ze',
          email: 'ze@example.com',
          organizationIds: [],
          disabledAt: new Date(),
        },
        { _id: 'u2', name: 'Ana', email: 'ana@example.com', organizationIds: [] },
      ]),
    );
    const { getUsersListForSession } = await import('@/app/lib/services/users');

    const result = await getUsersListForSession(session, {});

    expect(result.data.map((row) => row.disabled)).toEqual([true, false]);
  });
});
