/**
 * @jest-environment node
 */
export {};

// Backs `StoreScopeSelector` on the Estoque page. Same reasoning as
// `getOrganizationOptionsForSession`: the tenant boundary (authorized
// organization ids) is the answer, not a gate, so no System check here.
const connectDBMock = jest.fn();
const getAuthorizedOrganizationIdsMock = jest.fn();

const findSelectMock = jest.fn();
const findSortMock = jest.fn();
const findLeanMock = jest.fn();
const findMock = jest.fn();

jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  class NotFoundError extends HttpError {
    constructor(message = 'Not found.') {
      super(404, message);
      this.name = 'NotFoundError';
    }
  }
  class ConflictError extends HttpError {
    constructor(message = 'Conflict.') {
      super(409, message);
      this.name = 'ConflictError';
    }
  }
  return { HttpError, NotFoundError, ConflictError };
});
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/authorization', () => ({
  getAuthorizedOrganizationIds: getAuthorizedOrganizationIdsMock,
}));
jest.mock('@/app/lib/secret-encryption', () => ({
  encryptSecret: jest.fn((v: string) => `enc:${v}`),
  decryptSecret: jest.fn((v: string) => v.replace(/^enc:/, '')),
}));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: { find: findMock },
}));

const ORG_A = '665f735a90788d97f5a76322';
const ORG_B = '665f735a90788d97f5a76399';

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  getAuthorizedOrganizationIdsMock.mockResolvedValue([ORG_A, ORG_B]);

  findSelectMock.mockReturnValue({ sort: findSortMock });
  findSortMock.mockReturnValue({ lean: findLeanMock });
  findMock.mockReturnValue({ select: findSelectMock });
  findLeanMock.mockResolvedValue([
    { _id: 'store-1', name: 'Loja Centro', organizationId: ORG_A },
    { _id: 'store-2', name: 'Loja Zona Sul', organizationId: ORG_B },
  ]);
});

describe('getStoreOptionsForSession', () => {
  it('returns the stores across every organization the session may see', async () => {
    const { getStoreOptionsForSession } = await import('@/app/lib/services/stores');

    const result = await getStoreOptionsForSession({ user: { id: 'u1' } } as never);

    expect(result).toEqual([
      { _id: 'store-1', name: 'Loja Centro', organizationId: ORG_A },
      { _id: 'store-2', name: 'Loja Zona Sul', organizationId: ORG_B },
    ]);
  });

  it('narrows to one organization when it is authorized', async () => {
    const { getStoreOptionsForSession } = await import('@/app/lib/services/stores');

    await getStoreOptionsForSession({ user: { id: 'u1' } } as never, { organizationId: ORG_A });

    const query = findMock.mock.calls[0][0] as { organizationId: { $in: unknown[] } };
    expect(query.organizationId.$in).toHaveLength(1);
  });

  it('matches nothing for an organization the session is not authorized for', async () => {
    const { getStoreOptionsForSession } = await import('@/app/lib/services/stores');

    const result = await getStoreOptionsForSession({ user: { id: 'u1' } } as never, {
      organizationId: 'someone-elses-org',
    });

    expect(result).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it('treats "all" the same as no organization filter', async () => {
    const { getStoreOptionsForSession } = await import('@/app/lib/services/stores');

    await getStoreOptionsForSession({ user: { id: 'u1' } } as never, { organizationId: 'all' });

    const query = findMock.mock.calls[0][0] as { organizationId: { $in: unknown[] } };
    expect(query.organizationId.$in).toHaveLength(2);
  });
});
