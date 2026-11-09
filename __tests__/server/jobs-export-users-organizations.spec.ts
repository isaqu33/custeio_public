/**
 * @jest-environment node
 */
export {};

// The export hides the platform bootstrap account named here; pin it so the
// suite does not depend on a developer's local .env.
process.env.APP_USER_EMAIL = 'platform@example.com';

const leanMock = jest.fn();
const sortMock = jest.fn(() => ({ lean: leanMock }));
const populateMock = jest.fn(() => ({ sort: sortMock }));
const findMock = jest.fn(() => ({ populate: populateMock }));

jest.mock('@/app/models/users', () => ({
  __esModule: true,
  default: {
    find: findMock,
  },
}));

describe('exportUsersOrganizationsCsvJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds csv payload with organization names and escaping', async () => {
    const { exportUsersOrganizationsCsvJob } =
      await import('@/app/jobs/export-users-organizations');

    leanMock.mockResolvedValueOnce([
      {
        _id: 'u1',
        name: 'Alice, A.',
        email: 'alice@example.com',
        mustChangePassword: true,
        organizationIds: [{ name: 'Organization 1' }, { name: 'Organization "2"' }],
      },
      {
        _id: 'u2',
        name: 'Bob',
        email: 'bob@example.com',
        mustChangePassword: false,
        organizationIds: [],
      },
    ]);

    const result = await exportUsersOrganizationsCsvJob(
      {
        requestedByUserId: 'user-admin',
        authorizedOrganizationIds: ['e1'],
      },
      {
        jobId: 'job-1',
        bullJobId: 'bull-1',
        attempt: 1,
        maxAttempts: 1,
      },
    );

    expect(findMock).toHaveBeenCalledWith({
      $or: [{ organizationIds: { $size: 0 } }, { organizationIds: { $in: ['e1'] } }],
      // The platform bootstrap account is hidden from the Users screen, so it
      // must not reappear in the report that screen exports.
      email: { $nin: expect.arrayContaining([expect.any(String)]) },
    });
    expect(result.kind).toBe('users.export.csv');
    expect(result.rowCount).toBe(2);
    expect(result.mimeType).toBe('text/csv');

    const csv = Buffer.from(String(result.csvBase64), 'base64').toString('utf8');
    expect(csv).toContain(
      'user_id,name,email,last_sign_in_at,has_signed_in,must_change_password,organizations',
    );
    expect(csv).toContain('"Alice, A."');
    expect(csv).toContain('"Organization 1 | Organization ""2"""');
    expect(csv).toContain('No Organization');
  });
});

describe('sign-in activity in the accounts report', () => {
  it('stamps the last sign-in and flags accounts that never signed in', async () => {
    const { exportUsersOrganizationsCsvJob } =
      await import('@/app/jobs/export-users-organizations');
    leanMock.mockResolvedValueOnce([
      {
        _id: 'u1',
        name: 'Signed In',
        email: 'in@example.com',
        lastSignInAt: new Date('2026-08-17T18:54:00.000Z'),
        organizationIds: [{ name: 'Clinica A' }],
      },
      { _id: 'u2', name: 'Never', email: 'never@example.com', organizationIds: [] },
    ]);

    const result = await exportUsersOrganizationsCsvJob(
      { requestedByUserId: 'admin', authorizedOrganizationIds: ['org1'] },
      { jobId: 'j1', bullJobId: 'b1', attempt: 1, maxAttempts: 1 },
    );

    const [, signedIn, never] = Buffer.from(String(result.csvBase64), 'base64')
      .toString('utf8')
      .split('\n');
    expect(signedIn).toContain('2026-08-17T18:54:00.000Z');
    expect(signedIn).toContain('true');
    expect(never).toContain('false');
    // Accounts in use lead; dormant ones collect at the bottom.
    expect(sortMock).toHaveBeenCalledWith({ lastSignInAt: -1, name: 1 });
  });
});
