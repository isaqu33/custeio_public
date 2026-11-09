/**
 * @jest-environment node
 */
export {};

const leanMock = jest.fn();
const sortMock = jest.fn(() => ({ lean: leanMock }));
const selectMock = jest.fn(() => ({ sort: sortMock }));
type Filter = Record<string, unknown>;
const findMock = jest.fn((_filter: Filter) => ({ select: selectMock }));

jest.mock('@/app/models/organizations', () => ({ __esModule: true, default: { find: findMock } }));

const ORG_A = '507f1f77bcf86cd799439011';
const context = { jobId: 'j1', bullJobId: 'b1', attempt: 1, maxAttempts: 1 };

const { exportOrganizationsCsvJob } = require('@/app/jobs/export-organizations');

beforeEach(() => {
  jest.clearAllMocks();
  leanMock.mockResolvedValue([]);
});

function csvOf(result: Record<string, unknown>) {
  return Buffer.from(String(result.csvBase64), 'base64').toString('utf8');
}

describe('exportOrganizationsCsvJob', () => {
  it('exports onboarding and billing status per organization', async () => {
    leanMock.mockResolvedValue([
      {
        _id: ORG_A,
        name: 'Hamburgueria A',
        status: 'active',
        billingStatus: 'up_to_date',
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
      },
    ]);

    const result = await exportOrganizationsCsvJob(
      { requestedByUserId: 'admin', authorizedOrganizationIds: [ORG_A] },
      context,
    );

    expect(result.kind).toBe('organizations.export.csv');
    expect(String(result.fileName)).toMatch(/^organizations-/);
    const [header, row] = csvOf(result).split('\n');
    expect(header).toBe('organization_id,name,status,billing_status,created_at');
    expect(row).toContain('Hamburgueria A');
    expect(row).toContain('active,up_to_date');
  });

  it('never exports provider API keys', async () => {
    leanMock.mockResolvedValue([{ _id: ORG_A, name: 'Hamburgueria A' }]);
    const result = await exportOrganizationsCsvJob(
      { requestedByUserId: 'admin', authorizedOrganizationIds: [ORG_A] },
      context,
    );
    expect(csvOf(result)).not.toContain('sk-secret');
    const projection: string = selectMock.mock.calls.at(0)?.at(0) ?? '';
    expect(projection).not.toContain('apiKey');
  });

  it('is scoped to the organizations the requester may see', async () => {
    await exportOrganizationsCsvJob(
      { requestedByUserId: 'admin', authorizedOrganizationIds: [ORG_A] },
      context,
    );
    const filter = findMock.mock.calls.at(0)?.at(0) as { _id: { $in: unknown[] } };
    expect(filter._id.$in).toHaveLength(1);
    expect(String(filter._id.$in.at(0))).toBe(ORG_A);
  });

  it('marks a suspended organization accordingly', async () => {
    leanMock.mockResolvedValue([{ _id: ORG_A, name: 'Off', status: 'suspended' }]);
    const result = await exportOrganizationsCsvJob(
      { requestedByUserId: 'admin', authorizedOrganizationIds: [ORG_A] },
      context,
    );
    expect(csvOf(result).split('\n').at(1)).toContain('suspended');
  });
});
