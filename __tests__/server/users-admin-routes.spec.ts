/**
 * @jest-environment node
 */
export {};

// The three administrative actions on the users table. All of them act on an
// account that is not the caller's, so each test states who is allowed to do it
// and what trace it leaves.
const requireAuthMock = jest.fn();
const requireSystemAccessMock = jest.fn();
const requireUserManagementAccessMock = jest.fn();
const requireSessionUserMock = jest.fn();
const connectDBMock = jest.fn();
const parseRouteInputMock = jest.fn();
const hashPasswordMock = jest.fn();
const logAuditEventMock = jest.fn();
const createImpersonationTokenMock = jest.fn();
const nextSystemLevelForToggleMock = jest.fn();
const findSystemAccessLossMock = jest.fn();
const isLastActiveSystemAccountMock = jest.fn();
const isProtectedAccountUserMock = jest.fn();

const usersUpdateOneMock = jest.fn();
const usersDeleteOneMock = jest.fn();
const usersFindOneLeanMock = jest.fn();
const usersFindOneMock = jest.fn(() => ({ lean: usersFindOneLeanMock }));
const usersFindByIdLeanMock = jest.fn();
const usersFindByIdSelectMock = jest.fn(() => ({ lean: usersFindByIdLeanMock }));
const usersFindByIdMock = jest.fn(() => ({ select: usersFindByIdSelectMock }));

jest.mock('@/app/lib/errors', () => {
  class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  class NotFoundError extends HttpError {
    constructor(message = 'Not found.') {
      super(404, 'NOT_FOUND', message);
    }
  }
  class ForbiddenError extends HttpError {
    constructor(message = 'Forbidden.') {
      super(403, 'FORBIDDEN', message);
    }
  }
  return { HttpError, NotFoundError, ForbiddenError, requireAuth: requireAuthMock };
});
jest.mock('@/app/lib/authorization', () => ({
  requireSystemAccess: requireSystemAccessMock,
  requireUserManagementAccess: requireUserManagementAccessMock,
  requireSessionUser: requireSessionUserMock,
}));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/api-route', () => ({ parseRouteInput: parseRouteInputMock }));
jest.mock('@/app/lib/password-hashing', () => ({ hashPassword: hashPasswordMock }));
jest.mock('@/app/lib/services/audit-events', () => ({ logAuditEvent: logAuditEventMock }));
jest.mock('@/app/lib/impersonation-token', () => ({
  createImpersonationToken: createImpersonationTokenMock,
}));
jest.mock('@/app/lib/services/system-access', () => ({
  nextSystemLevelForToggle: nextSystemLevelForToggleMock,
  findSystemAccessLoss: findSystemAccessLossMock,
  isLastActiveSystemAccount: isLastActiveSystemAccountMock,
}));
jest.mock('@/app/lib/protected-account', () => ({
  isProtectedAccountUser: isProtectedAccountUserMock,
  PROTECTED_ACCOUNT_MESSAGE: 'The platform account cannot be managed from here.',
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: {
    updateOne: usersUpdateOneMock,
    deleteOne: usersDeleteOneMock,
    findById: usersFindByIdMock,
    findOne: usersFindOneMock,
  },
}));
jest.mock('@/app/lib/observability', () => ({
  withObservability:
    (
      _name: string,
      handler: (_req: Request, _ctx: unknown, _obs: { log: unknown }) => Promise<Response>,
    ) =>
    async (req: Request, ctx: unknown) => {
      try {
        return await handler(req, ctx, {
          log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        });
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        return new Response(JSON.stringify({ done: false, error: e.code || e.message }), {
          status: e.status || 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    },
}));

const TARGET = '665f735a90788d97f5a76311';
const ORG_A = '665f735a90788d97f5a76322';
const ORG_B = '665f735a90788d97f5a76333';

function request(body: unknown = {}) {
  return new Request('http://localhost/api/users/x', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('users administrative routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: { id: 'admin-1' } });
    requireSessionUserMock.mockReturnValue({ user: { id: 'admin-1' } });
    requireSystemAccessMock.mockResolvedValue(undefined);
    requireUserManagementAccessMock.mockResolvedValue(undefined);
    connectDBMock.mockResolvedValue(undefined);
    hashPasswordMock.mockResolvedValue('hashed-new-password');
    usersUpdateOneMock.mockResolvedValue({ matchedCount: 1 });
    usersFindByIdLeanMock.mockResolvedValue({
      _id: TARGET,
      email: 'target@example.com',
      organizationIds: [ORG_A, ORG_B],
    });
    createImpersonationTokenMock.mockReturnValue('signed-token');
    usersDeleteOneMock.mockResolvedValue({ deletedCount: 1 });
    usersFindOneLeanMock.mockResolvedValue(null);
    nextSystemLevelForToggleMock.mockResolvedValue(['support']);
    findSystemAccessLossMock.mockResolvedValue(null);
    isLastActiveSystemAccountMock.mockResolvedValue(false);
    isProtectedAccountUserMock.mockResolvedValue(false);
  });

  describe('reset password', () => {
    beforeEach(() => {
      parseRouteInputMock.mockResolvedValue({
        userId: TARGET,
        newPassword: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      });
    });

    it('stores a hash and forces a change on the next sign-in', async () => {
      const { POST } = await import('@/app/api/users/reset-password/route');
      const res = await POST(request(), {});

      expect(res.status).toBe(200);
      const update = usersUpdateOneMock.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
      // Never the plaintext, and always temporary: the operator who typed it
      // must not keep working access to the account.
      expect(update.$set.password).toBe('hashed-new-password');
      expect(update.$set.mustChangePassword).toBe(true);
      expect(hashPasswordMock).toHaveBeenCalledWith('brand-new-password');
    });

    it('audits the reset in every organization the user belongs to', async () => {
      const { POST } = await import('@/app/api/users/reset-password/route');
      await POST(request(), {});

      expect(logAuditEventMock).toHaveBeenCalledTimes(2);
      const organizations = logAuditEventMock.mock.calls.map((call) => call[0].organizationId);
      expect(organizations).toEqual([ORG_A, ORG_B]);
      expect(logAuditEventMock.mock.calls[0][0]).toMatchObject({
        action: 'users.reset_password',
        actorUserId: 'admin-1',
        resourceId: TARGET,
      });
    });

    it('is refused when the caller has no system access', async () => {
      requireSystemAccessMock.mockRejectedValue(
        Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
      );
      const { POST } = await import('@/app/api/users/reset-password/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('404s instead of reporting success when the user is gone', async () => {
      usersUpdateOneMock.mockResolvedValue({ matchedCount: 0 });
      const { POST } = await import('@/app/api/users/reset-password/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(404);
      expect(logAuditEventMock).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('deactivates the user by stamping disabledAt', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(200);
      const update = usersUpdateOneMock.mock.calls[0]?.[1] as {
        $set: { disabledAt: Date };
      };
      expect(update.$set.disabledAt).toBeInstanceOf(Date);
    });

    it('reactivates by removing disabledAt', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: false });
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(200);
      expect(usersUpdateOneMock.mock.calls[0]?.[1]).toEqual({ $unset: { disabledAt: '' } });
    });

    it('audits the change in every organization the user belongs to', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      const { POST } = await import('@/app/api/users/status/route');
      await POST(request(), {});

      expect(logAuditEventMock).toHaveBeenCalledTimes(2);
      expect(logAuditEventMock.mock.calls.map((call) => call[0].organizationId)).toEqual([
        ORG_A,
        ORG_B,
      ]);
      expect(logAuditEventMock.mock.calls[0][0]).toMatchObject({
        action: 'users.disable',
        actorUserId: 'admin-1',
        resourceId: TARGET,
      });
    });

    it('audits a reactivation under its own action', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: false });
      const { POST } = await import('@/app/api/users/status/route');
      await POST(request(), {});

      expect(logAuditEventMock.mock.calls[0][0]).toMatchObject({ action: 'users.enable' });
    });

    it('refuses to deactivate the caller', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: 'admin-1', disabled: true });
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('refuses the protected platform account', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      isProtectedAccountUserMock.mockResolvedValue(true);
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('refuses to deactivate the last active account with system access', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      isLastActiveSystemAccountMock.mockResolvedValue(true);
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('does not apply the last-account rule when reactivating', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: false });
      isLastActiveSystemAccountMock.mockResolvedValue(true);
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(200);
    });

    it('is refused when the caller has no system access', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      requireSystemAccessMock.mockRejectedValue(
        Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
      );
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('404s instead of reporting success when the user is gone', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, disabled: true });
      usersUpdateOneMock.mockResolvedValue({ matchedCount: 0 });
      const { POST } = await import('@/app/api/users/status/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(404);
      expect(logAuditEventMock).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the target user', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET });
      const { DELETE } = await import('@/app/api/users/delete/route');

      const res = await DELETE(request(), {});

      expect(res.status).toBe(200);
      const call = usersDeleteOneMock.mock.calls[0]?.[0] as { _id: { toString(): string } };
      expect(call._id.toString()).toBe(TARGET);
    });

    // The route's own session — not `requireUserManagementAccess`, which
    // happily allows self-service — is what has to catch this, since a
    // caller with system access always passes that check for themself.
    it('refuses to delete the caller’s own account', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: 'admin-1' });
      const { DELETE } = await import('@/app/api/users/delete/route');

      const res = await DELETE(request(), {});

      expect(res.status).toBe(403);
      expect(usersDeleteOneMock).not.toHaveBeenCalled();
    });
  });

  describe('system access toggle', () => {
    it('leaves system access untouched when the field is absent', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, name: 'New Name' });
      const { POST } = await import('@/app/api/users/update/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(200);
      expect(nextSystemLevelForToggleMock).not.toHaveBeenCalled();
      const update = usersUpdateOneMock.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
      expect(update.$set).not.toHaveProperty('systemLevel');
    });

    it('grants support-level access when the toggle turns on', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, hasSystemAccess: true });
      nextSystemLevelForToggleMock.mockResolvedValue(['support']);
      const { POST } = await import('@/app/api/users/update/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(200);
      const update = usersUpdateOneMock.mock.calls[0]?.[1] as {
        $set: { systemLevel: string[] };
      };
      expect(update.$set.systemLevel).toEqual(['support']);
    });

    it('refuses removing the caller’s own last-standing system access', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, hasSystemAccess: false });
      findSystemAccessLossMock.mockResolvedValue('self');
      const { POST } = await import('@/app/api/users/update/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('refuses stripping the last account with system access', async () => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET, hasSystemAccess: false });
      findSystemAccessLossMock.mockResolvedValue('last');
      const { POST } = await import('@/app/api/users/update/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });
  });

  describe('inspect', () => {
    beforeEach(() => {
      parseRouteInputMock.mockResolvedValue({ userId: TARGET });
    });

    it('audits before handing out the token', async () => {
      const { POST } = await import('@/app/api/users/inspect/route');
      const res = await POST(request(), {});
      const body = (await res.json()) as { token: string };

      expect(res.status).toBe(200);
      expect(body.token).toBe('signed-token');
      expect(logAuditEventMock).toHaveBeenCalledTimes(2);
      expect(logAuditEventMock.mock.calls[0][0]).toMatchObject({
        action: 'users.inspect',
        actorUserId: 'admin-1',
        resourceId: TARGET,
      });
      expect(createImpersonationTokenMock).toHaveBeenCalledWith({
        adminUserId: 'admin-1',
        targetUserId: TARGET,
      });
    });

    it('mints nothing when the caller has no system access', async () => {
      requireSystemAccessMock.mockRejectedValue(
        Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }),
      );
      const { POST } = await import('@/app/api/users/inspect/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(createImpersonationTokenMock).not.toHaveBeenCalled();
      expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('mints nothing for a user that does not exist', async () => {
      usersFindByIdLeanMock.mockResolvedValue(null);
      const { POST } = await import('@/app/api/users/inspect/route');

      const res = await POST(request(), {});

      expect(res.status).toBe(404);
      expect(createImpersonationTokenMock).not.toHaveBeenCalled();
    });
  });

  // The bootstrap account from APP_USER_EMAIL is the platform's own login. It is
  // hidden from the Users table, and hiding is not enough on its own: every one
  // of these routes takes a userId straight from the client.
  describe('the protected platform account', () => {
    beforeEach(() => {
      isProtectedAccountUserMock.mockResolvedValue(true);
      parseRouteInputMock.mockResolvedValue({
        userId: TARGET,
        organizationIds: [ORG_A],
        newPassword: 'brand-new-password',
        confirmPassword: 'brand-new-password',
        hasSystemAccess: false,
      });
    });

    it('cannot have its password reset', async () => {
      const { POST } = await import('@/app/api/users/reset-password/route');
      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('cannot be inspected', async () => {
      const { POST } = await import('@/app/api/users/inspect/route');
      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(createImpersonationTokenMock).not.toHaveBeenCalled();
    });

    it('cannot be edited', async () => {
      const { POST } = await import('@/app/api/users/update/route');
      const res = await POST(request(), {});

      expect(res.status).toBe(403);
      expect(usersUpdateOneMock).not.toHaveBeenCalled();
    });

    it('cannot be deleted', async () => {
      const { DELETE } = await import('@/app/api/users/delete/route');
      const res = await DELETE(
        new Request('http://localhost/api/users/delete', {
          method: 'DELETE',
        }),
        {},
      );

      expect(res.status).toBe(403);
      expect(usersDeleteOneMock).not.toHaveBeenCalled();
    });
  });
});
