/**
 * @jest-environment node
 */
export {};

const authMock = jest.fn();
const requireSameUserMock = jest.fn();
const connectDBMock = jest.fn();
const hashPasswordMock = jest.fn();
const passwordSafeParseMock = jest.fn();
const usersFindOneMock = jest.fn();
const usersUpdateOneMock = jest.fn();
const uploadFileMock = jest.fn();
const azuriteBlobAdapterMock = jest.fn();

jest.mock('@/app/lib/auth', () => ({ auth: authMock }));
jest.mock('@/app/lib/authorization', () => ({ requireSameUser: requireSameUserMock }));
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/password-hashing', () => ({ hashPassword: hashPasswordMock }));
jest.mock('@/app/lib/validations', () => ({
  passwordChange: { safeParse: passwordSafeParseMock },
}));
jest.mock('uuid', () => ({ v4: () => 'image-id' }));
jest.mock('@/app/lib/azure-blob-storage', () => ({
  AzuriteBlobAdapter: azuriteBlobAdapterMock.mockImplementation(() => ({
    uploadFile: uploadFileMock,
  })),
}));
jest.mock('@/app/lib/env', () => ({
  env: {
    APP_SYSTEM_ASSETS_CONTAINER: 'profile-assets',
  },
}));
jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: { findOne: usersFindOneMock, updateOne: usersUpdateOneMock },
}));
jest.mock('@/app/lib/observability', () => ({
  withObservability:
    (
      _name: string,
      handler: (_req: Request, _ctx: unknown, _obs: { log: unknown }) => Promise<Response>,
    ) =>
    async (req: Request, ctx: unknown) =>
      handler(req, ctx, { log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }),
}));

const userId = '665f735a90788d97f5a76311';

function profileForm(overrides: Record<string, string | File> = {}) {
  const form = new FormData();
  form.append('username', 'New Name');
  form.append('userEmail', 'new@example.com');
  form.append('userId', userId);
  form.append('currentUserName', 'Old Name');
  form.append('currentUserEmail', 'old@example.com');
  for (const [key, value] of Object.entries(overrides)) {
    form.set(key, value);
  }
  return form;
}

describe('users update profile route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: userId } });
    requireSameUserMock.mockResolvedValue(undefined);
    connectDBMock.mockResolvedValue(undefined);
    usersFindOneMock.mockResolvedValue(null);
    usersUpdateOneMock.mockResolvedValue({ matchedCount: 1 });
    hashPasswordMock.mockResolvedValue('hashed-password');
    passwordSafeParseMock.mockReturnValue({
      success: true,
      data: { newPassword: 'new-password' },
    });
    uploadFileMock.mockResolvedValue('image_image-id.jpeg');
  });

  it('returns 401 when session is missing', async () => {
    authMock.mockResolvedValueOnce(null);
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(new Request('http://localhost/api/users/profile'), {});

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid user id', async () => {
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm({ userId: 'bad' }),
      }),
      {},
    );

    expect(res.status).toBe(400);
    expect(requireSameUserMock).not.toHaveBeenCalled();
  });

  it('returns ok with no update when nothing changed', async () => {
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm({ username: 'Old Name', userEmail: 'old@example.com' }),
      }),
      {},
    );

    expect(res.status).toBe(200);
    expect(usersUpdateOneMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate email before updating', async () => {
    usersFindOneMock.mockResolvedValueOnce({ _id: 'other-user' });
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm(),
      }),
      {},
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ done: false, error: 'CONFLICT' });
    expect(usersUpdateOneMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid password confirmation', async () => {
    passwordSafeParseMock.mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'Passwords do not match.' }] },
    });
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm({ password: 'one', confirmPassword: 'two' }),
      }),
      {},
    );

    expect(res.status).toBe(400);
    expect(usersUpdateOneMock).not.toHaveBeenCalled();
  });

  it('uploads image, hashes password and updates profile', async () => {
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm({
          password: 'new-password',
          confirmPassword: 'new-password',
          profileImage: new File(['image'], 'profile.jpg', { type: 'image/jpeg' }),
        }),
      }),
      {},
    );

    expect(res.status).toBe(200);
    expect(azuriteBlobAdapterMock).toHaveBeenCalledWith('profile-assets');
    expect(uploadFileMock).toHaveBeenCalledWith(expect.any(Buffer), 'image_image-id.jpeg');
    expect(hashPasswordMock).toHaveBeenCalledWith('new-password');
    expect(usersUpdateOneMock).toHaveBeenCalledWith(
      { _id: expect.any(Object) },
      {
        $set: expect.objectContaining({
          email: 'new@example.com',
          name: 'New Name',
          mustChangePassword: false,
          password: 'hashed-password',
          urlString: '/api/assets/image_image-id.jpeg',
        }),
      },
    );
  });

  it('returns 404 when user update matches no document', async () => {
    usersUpdateOneMock.mockResolvedValueOnce({ matchedCount: 0 });
    const { POST } = await import('@/app/api/users/profile/route');
    const res = await POST(
      new Request('http://localhost/api/users/profile', {
        method: 'POST',
        body: profileForm(),
      }),
      {},
    );

    expect(res.status).toBe(404);
  });
});
