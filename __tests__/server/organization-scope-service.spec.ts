/**
 * @jest-environment node
 */
export {};

const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();

const leanMock = jest.fn();
const sortMock = jest.fn(() => ({ lean: leanMock }));
const selectMock = jest.fn(() => ({ sort: sortMock }));
type Filter = Record<string, unknown>;
const findMock = jest.fn((_filter: Filter) => ({ select: selectMock }));

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
}));
jest.mock('@/app/models/organizations', () => ({ __esModule: true, default: { find: findMock } }));

const ORG_A = '507f1f77bcf86cd799439011';
const ORG_B = '507f1f77bcf86cd799439012';
const OUTSIDER = '507f1f77bcf86cd799439099';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const session = { user: { id: '507f1f77bcf86cd799439013' } } as any;

const { resolveOrganizationScope } = require('@/app/lib/services/organization-scope');

beforeEach(() => {
  jest.clearAllMocks();
  getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A, ORG_B]);
  leanMock.mockResolvedValue([
    { _id: { toString: () => ORG_A }, name: 'Clinica A' },
    { _id: { toString: () => ORG_B }, name: 'Clinica B' },
  ]);
});

describe('resolveOrganizationScope', () => {
  it('falls back to every authorized organization when no scope is given', async () => {
    const scope = await resolveOrganizationScope(session, undefined);
    expect(scope.ids).toEqual([ORG_A, ORG_B]);
    expect(scope.organizations).toHaveLength(2);
  });

  it('treats "all" as the full authorized set', async () => {
    const scope = await resolveOrganizationScope(session, 'all');
    expect(scope.ids).toEqual([ORG_A, ORG_B]);
  });

  it('narrows to a requested organization', async () => {
    leanMock.mockResolvedValue([{ _id: { toString: () => ORG_A }, name: 'Clinica A' }]);
    const scope = await resolveOrganizationScope(session, ORG_A);
    expect(scope.ids).toEqual([ORG_A]);
    expect(scope.organizations).toEqual([{ _id: ORG_A, name: 'Clinica A' }]);
  });

  it('never widens the scope past what the session may see', async () => {
    const scope = await resolveOrganizationScope(session, OUTSIDER);
    expect(scope).toEqual({ ids: [], organizations: [] });
    expect(findMock).not.toHaveBeenCalled();
  });

  it('returns an empty scope when the session has no organizations', async () => {
    getAuthorizedOrganizationIdsMock.mockResolvedValue([]);
    const scope = await resolveOrganizationScope(session, 'all');
    expect(scope).toEqual({ ids: [], organizations: [] });
    expect(findMock).not.toHaveBeenCalled();
  });
});
