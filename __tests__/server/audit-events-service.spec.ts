/**
 * @jest-environment node
 */
export {};

const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();
const loggerWarnMock = jest.fn();

const createMock = jest.fn();
const countDocumentsMock = jest.fn();
const distinctMock = jest.fn();
const leanMock = jest.fn();
const populateOrgMock = jest.fn(() => ({ lean: leanMock }));
const populateActorMock = jest.fn(() => ({ populate: populateOrgMock }));
const limitMock = jest.fn(() => ({ populate: populateActorMock }));
const skipMock = jest.fn(() => ({ limit: limitMock }));
const sortMock = jest.fn(() => ({ skip: skipMock }));
type Query = Record<string, { $in?: unknown[]; $gte?: Date; $lte?: Date }>;
const findMock = jest.fn((_query: Query) => ({ sort: sortMock }));

const usersLeanMock = jest.fn();
const usersSelectMock = jest.fn(() => ({ lean: usersLeanMock }));
const usersFindMock = jest.fn(() => ({ select: usersSelectMock }));

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
}));
jest.mock('@/app/lib/logger', () => ({ logger: { warn: loggerWarnMock } }));
jest.mock('@/app/models/audit-events', () => ({
  __esModule: true,
  default: {
    create: createMock,
    find: findMock,
    countDocuments: countDocumentsMock,
    distinct: distinctMock,
  },
}));
jest.mock('@/app/models/users', () => ({ __esModule: true, default: { find: usersFindMock } }));

const ORG_A = '507f1f77bcf86cd799439011';
const ORG_B = '507f1f77bcf86cd799439012';
const ACTOR = '507f1f77bcf86cd799439013';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const session = { user: { id: ACTOR } } as any;

const { logAuditEvent, listAuditEventsForSession } = require('@/app/lib/services/audit-events');

beforeEach(() => {
  jest.clearAllMocks();
  leanMock.mockResolvedValue([]);
  countDocumentsMock.mockResolvedValue(0);
  distinctMock.mockResolvedValue([]);
});

describe('logAuditEvent', () => {
  it('records the event with the given actor', async () => {
    await logAuditEvent({
      organizationId: ORG_A,
      actorUserId: ACTOR,
      action: 'token.create',
      resourceType: 'token',
      source: 'ui',
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const doc = createMock.mock.calls[0][0];
    expect(doc.action).toBe('token.create');
    expect(doc.outcome).toBe('success');
    expect(String(doc.organizationId)).toBe(ORG_A);
    expect(String(doc.actorUserId)).toBe(ACTOR);
  });

  it('stores a null actor when no user is available', async () => {
    await logAuditEvent({
      organizationId: ORG_A,
      action: 'analysis.received',
      resourceType: 'job',
      source: 'worker',
    });

    expect(createMock.mock.calls[0][0].actorUserId).toBeNull();
  });

  // The caller is mid-action; losing the trail must never fail the action.
  it('swallows write failures and logs them instead of throwing', async () => {
    createMock.mockRejectedValueOnce(new Error('mongo down'));

    await expect(
      logAuditEvent({
        organizationId: ORG_A,
        action: 'token.create',
        resourceType: 'token',
        source: 'ui',
      }),
    ).resolves.toBeUndefined();

    expect(loggerWarnMock).toHaveBeenCalled();
  });
});

describe('listAuditEventsForSession', () => {
  it('returns nothing when the session has no organizations', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([]);

    const result = await listAuditEventsForSession(session);

    expect(result).toMatchObject({ done: true, data: [], total: 0 });
    expect(findMock).not.toHaveBeenCalled();
  });

  // The tenant guard: a client-supplied organizationId may only narrow the
  // authorized set, never reach outside it.
  it('ignores an organizationId the session is not authorized for', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A]);

    const result = await listAuditEventsForSession(session, { organizationId: ORG_B });

    expect(result.data).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the authorized organizations', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A, ORG_B]);

    await listAuditEventsForSession(session);

    const query = findMock.mock.calls[0]?.[0];
    expect(query?.organizationId?.$in?.map(String)).toEqual([ORG_A, ORG_B]);
  });

  it('widens the end date to the end of that day', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A]);

    await listAuditEventsForSession(session, { dateFrom: '2026-08-10', dateTo: '2026-08-10' });

    const createdAt = findMock.mock.calls[0]?.[0]?.createdAt;
    expect(createdAt?.$gte?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(createdAt?.$lte?.toISOString()).toBe('2026-08-10T23:59:59.999Z');
  });

  it('returns nothing when the actor filter matches no user', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A]);
    usersLeanMock.mockResolvedValue([]);

    const result = await listAuditEventsForSession(session, { actor: 'ghost' });

    expect(result.data).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it('flattens the populated actor and organization onto the row', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A]);
    countDocumentsMock.mockResolvedValue(1);
    distinctMock.mockResolvedValue(['token.create']);
    leanMock.mockResolvedValue([
      {
        _id: 'evt1',
        organizationId: { _id: ORG_A, name: 'Clínica Central' },
        actorUserId: { _id: ACTOR, name: 'Ana', email: 'ana@example.com' },
        action: 'token.create',
        resourceType: 'token',
        source: 'ui',
        outcome: 'success',
        createdAt: new Date('2026-08-10T12:00:00.000Z'),
      },
    ]);

    const result = await listAuditEventsForSession(session);

    expect(result.data[0]).toMatchObject({
      _id: 'evt1',
      organizationName: 'Clínica Central',
      actorName: 'Ana',
      actorEmail: 'ana@example.com',
      action: 'token.create',
    });
    expect(result.actions).toEqual(['token.create']);
  });
});
