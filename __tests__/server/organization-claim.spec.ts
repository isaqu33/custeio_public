/**
 * @jest-environment node
 */
export {};

// The public claim flow. The link is the only credential, so what these tests
// pin down is what a stranger can and cannot learn or do with a token — and
// that a link is single-use even when two people race for it.
const connectDBMock = jest.fn();
const hashPasswordMock = jest.fn();
const logAuditEventMock = jest.fn();

const orgFindOneLeanMock = jest.fn();
const orgFindOneSelectMock = jest.fn(() => ({ lean: orgFindOneLeanMock }));
const orgFindOneMock = jest.fn(() => ({ select: orgFindOneSelectMock }));
const orgFindOneAndUpdateMock = jest.fn();

const usersFindOneLeanMock = jest.fn();
const usersFindOneMock = jest.fn(() => ({ lean: usersFindOneLeanMock }));
const usersCreateMock = jest.fn();
const usersDeleteOneMock = jest.fn();

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
jest.mock('@/app/lib/password-hashing', () => ({ hashPassword: hashPasswordMock }));
jest.mock('@/app/lib/services/audit-events', () => ({ logAuditEvent: logAuditEventMock }));
jest.mock('@/app/models/organizations', () => ({
  __esModule: true,
  default: { findOne: orgFindOneMock, findOneAndUpdate: orgFindOneAndUpdateMock },
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: {
    findOne: usersFindOneMock,
    create: usersCreateMock,
    deleteOne: usersDeleteOneMock,
  },
}));

const TOKEN = 'a'.repeat(48);
const ORG_ID = '665f735a90788d97f5a76322';
const USER_ID = '665f735a90788d97f5a76399';

const input = {
  token: TOKEN,
  name: 'Ze da Silva',
  email: 'ze@example.com',
  password: 'fixture-not-a-real-secret',
};

function claimableOrganization(overrides: Record<string, unknown> = {}) {
  return { _id: { toString: () => ORG_ID }, name: 'Hamburgueria do Ze', ...overrides };
}

describe('findClaimableOrganization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    orgFindOneLeanMock.mockResolvedValue(claimableOrganization());
  });

  it('returns the organization for a valid, open token', async () => {
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');

    expect(await findClaimableOrganization(TOKEN)).toEqual({
      id: ORG_ID,
      name: 'Hamburgueria do Ze',
    });
  });

  it('only matches organizations in a claimable status', async () => {
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');
    await findClaimableOrganization(TOKEN);

    expect(orgFindOneMock).toHaveBeenCalledWith({
      inviteToken: TOKEN,
      status: { $in: ['onboarding', 'active'] },
    });
  });

  it.each([
    ['too short', 'abc'],
    ['not hex', 'z'.repeat(48)],
    ['a query operator', '{"$ne":null}'],
    ['empty', ''],
  ])('never queries for a malformed token (%s)', async (_label, token) => {
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');

    expect(await findClaimableOrganization(token)).toBeNull();
    expect(orgFindOneMock).not.toHaveBeenCalled();
  });

  it('returns null for an unknown token', async () => {
    orgFindOneLeanMock.mockResolvedValue(null);
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');

    expect(await findClaimableOrganization(TOKEN)).toBeNull();
  });

  it('returns null once the invite has expired', async () => {
    orgFindOneLeanMock.mockResolvedValue(
      claimableOrganization({ inviteExpiresAt: new Date(Date.now() - 1000) }),
    );
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');

    expect(await findClaimableOrganization(TOKEN)).toBeNull();
  });

  it('accepts an invite that has no expiry (issued before expiry existed)', async () => {
    orgFindOneLeanMock.mockResolvedValue(claimableOrganization({ inviteExpiresAt: undefined }));
    const { findClaimableOrganization } = await import('@/app/lib/services/organization-claim');

    expect(await findClaimableOrganization(TOKEN)).not.toBeNull();
  });
});

describe('claimInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectDBMock.mockResolvedValue(undefined);
    hashPasswordMock.mockResolvedValue('fixture-hashed-value');
    orgFindOneLeanMock.mockResolvedValue(claimableOrganization());
    usersFindOneLeanMock.mockResolvedValue(null);
    usersCreateMock.mockResolvedValue({ _id: { toString: () => USER_ID } });
    orgFindOneAndUpdateMock.mockResolvedValue({ _id: ORG_ID });
    usersDeleteOneMock.mockResolvedValue({ deletedCount: 1 });
  });

  it('creates the owner, links the organization and consumes the invite', async () => {
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    const result = await claimInvite(input);

    expect(result).toEqual({ organizationId: ORG_ID });
    // Never the plaintext, and not temporary: the owner just chose it.
    expect(usersCreateMock).toHaveBeenCalledWith({
      name: 'Ze da Silva',
      email: 'ze@example.com',
      password: 'fixture-hashed-value',
      organizationIds: [ORG_ID],
      mustChangePassword: false,
    });
    expect(orgFindOneAndUpdateMock).toHaveBeenCalledWith(
      { _id: ORG_ID, inviteToken: TOKEN, status: { $in: ['onboarding', 'active'] } },
      { $set: { status: 'active' }, $unset: { inviteToken: '', inviteExpiresAt: '' } },
    );
  });

  it('grants no system access — the new account only reaches its own organization', async () => {
    const { claimInvite } = await import('@/app/lib/services/organization-claim');
    await claimInvite(input);

    const created = usersCreateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(created).not.toHaveProperty('systemLevel');
  });

  it('audits the claim with the new user as the actor', async () => {
    const { claimInvite } = await import('@/app/lib/services/organization-claim');
    await claimInvite(input);

    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        action: 'organization.claim_invite',
      }),
    );
  });

  it('answers a bad link with a 404 and creates nothing', async () => {
    orgFindOneLeanMock.mockResolvedValue(null);
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    await expect(claimInvite(input)).rejects.toMatchObject({ status: 404 });
    expect(usersCreateMock).not.toHaveBeenCalled();
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  it('refuses an email that already has an account, without burning the invite', async () => {
    usersFindOneLeanMock.mockResolvedValue({ _id: 'existing' });
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    await expect(claimInvite(input)).rejects.toMatchObject({ status: 409 });
    expect(usersCreateMock).not.toHaveBeenCalled();
    expect(orgFindOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it('treats a unique-index collision on email as a conflict, not a 500', async () => {
    usersCreateMock.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    await expect(claimInvite(input)).rejects.toMatchObject({ status: 409 });
    expect(orgFindOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it('removes the new user again when someone else consumed the link first', async () => {
    orgFindOneAndUpdateMock.mockResolvedValue(null);
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    await expect(claimInvite(input)).rejects.toMatchObject({ status: 404 });
    expect(usersDeleteOneMock).toHaveBeenCalledWith({ _id: USER_ID });
    expect(logAuditEventMock).not.toHaveBeenCalled();
  });

  it('does not swallow an unexpected database error', async () => {
    usersCreateMock.mockRejectedValue(new Error('mongo went away'));
    const { claimInvite } = await import('@/app/lib/services/organization-claim');

    await expect(claimInvite(input)).rejects.toThrow('mongo went away');
  });
});
