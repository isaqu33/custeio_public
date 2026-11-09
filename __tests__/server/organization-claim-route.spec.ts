/**
 * @jest-environment node
 */
export {};

// The public endpoint: no session, but a tight per-IP rate limit and a body the
// schema has to accept before anything reaches the service.
const claimInviteMock = jest.fn();
const observabilityOptionsMock = jest.fn();

jest.mock('@/app/lib/env', () => ({ env: { APP_RATE_LIMIT_CLAIM_PER_MIN: 7 } }));
jest.mock('@/app/lib/services/organization-claim', () => ({ claimInvite: claimInviteMock }));
jest.mock('@/app/lib/observability', () => ({
  withObservabilityOptions: (
    name: string,
    handler: (_req: Request) => Promise<Response>,
    options: unknown,
  ) => {
    observabilityOptionsMock(name, options);
    return async (req: Request) => {
      try {
        return await handler(req);
      } catch (err) {
        const e = err as { name?: string };
        // ZodError is what the real wrapper turns into a 400.
        return new Response('{}', { status: e.name === 'ZodError' ? 400 : 500 });
      }
    };
  },
}));

const TOKEN = 'a'.repeat(48);

function request(body: unknown) {
  return new Request('http://localhost/api/organizations/claim', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/organizations/claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    claimInviteMock.mockResolvedValue({ organizationId: 'org-1' });
  });

  it('is rate limited per IP under its own scope, with the configured budget', async () => {
    await import('@/app/api/organizations/claim/route');

    expect(observabilityOptionsMock).toHaveBeenCalledWith('organizations.claim_invite', {
      rateLimit: { limit: 7, scope: 'claim' },
    });
  });

  it('creates the account from a valid body — without needing a session', async () => {
    const { POST } = await import('@/app/api/organizations/claim/route');

    const res = await POST(
      request({
        token: TOKEN,
        name: 'Ze',
        email: ' ze@example.com ',
        password: 'fixture-not-a-real-secret',
      }),
      {},
    );

    expect(res.status).toBe(201);
    // Trimmed by the schema before it reaches the service.
    expect(claimInviteMock).toHaveBeenCalledWith({
      token: TOKEN,
      name: 'Ze',
      email: 'ze@example.com',
      password: 'fixture-not-a-real-secret',
    });
  });

  it('never echoes the token back', async () => {
    const { POST } = await import('@/app/api/organizations/claim/route');

    const res = await POST(
      request({
        token: TOKEN,
        name: 'Ze',
        email: 'ze@example.com',
        password: 'fixture-not-a-real-secret',
      }),
      {},
    );

    expect(await res.text()).not.toContain(TOKEN);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['no token', { token: undefined }],
  ])('rejects %s before reaching the service', async (_label, override) => {
    const { POST } = await import('@/app/api/organizations/claim/route');

    const res = await POST(
      request({
        token: TOKEN,
        name: 'Ze',
        email: 'ze@example.com',
        password: 'fixture-not-a-real-secret',
        ...override,
      }),
      {},
    );

    expect(res.status).toBe(400);
    expect(claimInviteMock).not.toHaveBeenCalled();
  });
});
