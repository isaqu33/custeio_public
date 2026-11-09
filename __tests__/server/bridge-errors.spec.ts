/**
 * @jest-environment node
 */
export {};

// The errors view reads the bridge, and an unreachable bridge is a state of its own, not a crash.
const getConnectionMock = jest.fn();
const configuredMock = jest.fn();

jest.mock('@/app/lib/bridge-db', () => ({
  getBridgeConnection: getConnectionMock,
  isBridgeConfigured: configuredMock,
}));
jest.mock('@/app/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/app/lib/services/bridge-pull', () => ({ MAX_SYNC_ATTEMPTS: 3 }));

const cursor = (docs: unknown[]) => ({
  sort: () => ({ limit: () => ({ toArray: () => Promise.resolve(docs) }) }),
});

function fakeConnection(data: {
  quarantined?: unknown[];
  noStore?: unknown[];
  rejections?: unknown[];
}) {
  const events = {
    find: (filter: { syncResult?: string }) =>
      cursor(filter.syncResult === 'error' ? (data.quarantined ?? []) : (data.noStore ?? [])),
    countDocuments: (filter: { syncResult?: string }) =>
      Promise.resolve(filter.syncResult === 'no_store' ? (data.noStore ?? []).length : 0),
  };
  const errors = { aggregate: () => ({ toArray: () => Promise.resolve(data.rejections ?? []) }) };
  return { collection: (name: string) => (name === 'events' ? events : errors) };
}

beforeEach(() => {
  jest.clearAllMocks();
  configuredMock.mockReturnValue(true);
});

describe('getBridgeErrors', () => {
  it('says the bridge is not configured, without touching it', async () => {
    configuredMock.mockReturnValue(false);
    const { getBridgeErrors } = await import('@/app/lib/services/bridge-errors');

    await expect(getBridgeErrors()).resolves.toMatchObject({
      configured: false,
      unavailable: false,
    });
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('reports an unreachable bridge as unavailable instead of throwing', async () => {
    getConnectionMock.mockRejectedValue(new Error('timed out'));
    const { getBridgeErrors } = await import('@/app/lib/services/bridge-errors');

    await expect(getBridgeErrors()).resolves.toMatchObject({ configured: true, unavailable: true });
  });

  it('lists the events put aside, the events with no store and the refusals', async () => {
    getConnectionMock.mockResolvedValue(
      fakeConnection({
        quarantined: [
          {
            _id: 'e1',
            receivedAt: new Date('2026-10-10T00:20:00Z'),
            event: 'novo_pedido',
            externalOrderId: '1650',
            syncAttempts: 3,
            syncError: 'validation failed',
            lastErrorAt: new Date('2026-10-10T00:30:00Z'),
          },
        ],
        noStore: [{ _id: 'n1', receivedAt: new Date('2026-10-10T00:10:00Z') }],
        rejections: [
          {
            _id: 'wrong_key',
            total: 5,
            last24h: 5,
            lastAt: new Date('2026-10-10T01:00:00Z'),
            status: 401,
          },
        ],
      }),
    );
    const { getBridgeErrors } = await import('@/app/lib/services/bridge-errors');

    const view = await getBridgeErrors();

    expect(view.quarantined).toEqual([
      expect.objectContaining({
        id: 'e1',
        orderRef: '1650',
        attempts: 3,
        error: 'validation failed',
      }),
    ]);
    expect(view.noStore).toEqual({ count: 1, lastAt: '2026-10-10T00:10:00.000Z' });
    expect(view.rejections).toEqual([
      expect.objectContaining({ reason: 'wrong_key', total: 5, last24h: 5, status: 401 }),
    ]);
    expect(view.maxAttempts).toBe(3);
  });
});
