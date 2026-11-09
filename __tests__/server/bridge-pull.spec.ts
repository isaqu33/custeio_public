/**
 * @jest-environment node
 */
export {};

// The pull from the webhook bridge: what it kept goes through the same recording as the public
// webhook, each event is marked synced on the bridge, and a failure leaves the rest for next time.
const connectDBMock = jest.fn();
const storeFindOneMock = jest.fn();
const recordMock = jest.fn();
const enqueueMock = jest.fn();
const envMock: { BRIDGE_MONGODB_URI?: string; BRIDGE_MONGODB_DB: string } = {
  BRIDGE_MONGODB_DB: 'bridge',
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/env', () => ({ env: envMock }));
jest.mock('@/app/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: { findOne: storeFindOneMock },
}));
jest.mock('@/app/lib/services/pos-events', () => ({ recordParsedDelivery: recordMock }));
jest.mock('@/app/lib/services/pos-order-enqueue', () => ({
  enqueuePosOrderReceived: enqueueMock,
}));

const STORE = { _id: '665f735a90788d97f5a76322', externalId: '18424' };

function lookup(store: unknown) {
  storeFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(store) }) });
}

type FakeEvent = { _id: string; keyHash: string; dedupeKey: string; payload: unknown };

function fakeBridge(batches: FakeEvent[][]) {
  const queue = [...batches];
  const updates: Array<{ id: unknown; set: Record<string, unknown> }> = [];
  const finds: unknown[] = [];
  const collection = {
    find: (filter: unknown) => {
      finds.push(filter);
      return {
        sort: () => ({
          limit: () => ({ toArray: () => Promise.resolve(queue.shift() ?? []) }),
        }),
      };
    },
    updateOne: (filter: { _id: unknown }, update: { $set: Record<string, unknown> }) => {
      updates.push({ id: filter._id, set: update.$set });
      return Promise.resolve();
    },
  };
  return { collection, updates, finds };
}

const event = (n: number, keyHash = 'hash-a'): FakeEvent => ({
  _id: `e${n}`,
  keyHash,
  dedupeKey: `d${n}`,
  payload: { evento: 'novo_pedido', pedido: { ref: n } },
});

beforeEach(() => {
  jest.clearAllMocks();
  envMock.BRIDGE_MONGODB_URI = undefined;
  connectDBMock.mockResolvedValue(undefined);
  lookup(STORE);
  recordMock.mockResolvedValue({ result: 'recorded', eventId: 'evt1', storeId: STORE._id });
});

describe('pullFromCollection', () => {
  it('records a new event, hands it to the order job and marks it synced', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    const bridge = fakeBridge([[event(1)]]);

    const result = await pullFromCollection(bridge.collection);

    expect(result).toMatchObject({ configured: true, fetched: 1, recorded: 1 });
    expect(storeFindOneMock.mock.calls[0][0]).toEqual({
      provider: 'alloy',
      webhookKeyHash: 'hash-a',
    });
    expect(recordMock).toHaveBeenCalledWith({
      store: STORE,
      body: event(1).payload,
      dedupeKey: 'd1',
    });
    expect(enqueueMock).toHaveBeenCalledWith({ storeId: STORE._id, eventId: 'evt1' });
    expect(bridge.updates).toHaveLength(1);
    expect(bridge.updates[0]).toMatchObject({ id: 'e1', set: { syncResult: 'recorded' } });
    expect(bridge.updates[0]!.set.syncedAt).toBeInstanceOf(Date);
    // Only the events not yet synced are asked for.
    expect(bridge.finds[0]).toEqual({ syncedAt: { $exists: false } });
  });

  it('marks a repeated delivery synced without enqueueing it again', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    recordMock.mockResolvedValue({ result: 'duplicate' });
    const bridge = fakeBridge([[event(1)]]);

    const result = await pullFromCollection(bridge.collection);

    expect(result).toMatchObject({ fetched: 1, recorded: 0, duplicate: 1 });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(bridge.updates[0]!.set.syncResult).toBe('duplicate');
  });

  it('counts an event with a key no Store has, and does not record it', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    lookup(null);
    const bridge = fakeBridge([[event(1, 'unknown')]]);

    const result = await pullFromCollection(bridge.collection);

    expect(result).toMatchObject({ fetched: 1, recorded: 0, noStore: 1 });
    expect(recordMock).not.toHaveBeenCalled();
    expect(bridge.updates[0]!.set.syncResult).toBe('no_store');
  });

  it('looks each key up once and keeps the bridge order', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    recordMock
      .mockResolvedValueOnce({ result: 'recorded', eventId: 'a', storeId: STORE._id })
      .mockResolvedValueOnce({ result: 'recorded', eventId: 'b', storeId: STORE._id });
    const bridge = fakeBridge([[event(1), event(2)]]);

    await pullFromCollection(bridge.collection);

    expect(storeFindOneMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls.map((call) => call[0].eventId)).toEqual(['a', 'b']);
    expect(bridge.updates.map((u) => u.id)).toEqual(['e1', 'e2']);
  });

  it('puts an event that fails aside and goes on with the next ones', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    recordMock
      .mockResolvedValueOnce({ result: 'recorded', eventId: 'a', storeId: STORE._id })
      .mockRejectedValueOnce(new Error('validation failed: kind'))
      .mockResolvedValueOnce({ result: 'recorded', eventId: 'c', storeId: STORE._id });
    const bridge = fakeBridge([[event(1), event(2), event(3)]]);

    const result = await pullFromCollection(bridge.collection);

    expect(result).toMatchObject({ fetched: 3, recorded: 2, errors: 1 });
    expect(bridge.updates.map((u) => u.id)).toEqual(['e1', 'e2', 'e3']);
    // First failure: counted and kept for another try, NOT marked synced.
    expect(bridge.updates[1]!.set).toMatchObject({
      syncAttempts: 1,
      syncError: 'validation failed: kind',
    });
    expect(bridge.updates[1]!.set.syncedAt).toBeUndefined();
  });

  it('gives up on an event after the third failure and marks it as an error', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    recordMock.mockRejectedValue(new Error('boom mongodb://user:secret@host/db'));
    const failing = { ...event(1), syncAttempts: 2 };
    const bridge = fakeBridge([[failing]]);

    await pullFromCollection(bridge.collection);

    expect(bridge.updates[0]!.set).toMatchObject({ syncAttempts: 3, syncResult: 'error' });
    expect(bridge.updates[0]!.set.syncedAt).toBeInstanceOf(Date);
    // The stored message never carries a connection string.
    expect(String(bridge.updates[0]!.set.syncError)).not.toContain('secret');
  });

  it('does not blame the event when the infrastructure is down, and ends the run', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    const down = Object.assign(new Error('connect ECONNREFUSED'), {
      name: 'MongooseServerSelectionError',
    });
    recordMock.mockRejectedValue(down);
    const bridge = fakeBridge([[event(1), event(2)]]);

    await expect(pullFromCollection(bridge.collection)).rejects.toThrow('ECONNREFUSED');

    expect(bridge.updates).toHaveLength(0);
  });

  it('keeps reading while batches come back full', async () => {
    const { pullFromCollection } = await import('@/app/lib/services/bridge-pull');
    const full = Array.from({ length: 200 }, (_, i) => event(i));
    const bridge = fakeBridge([full, [event(500)]]);

    const result = await pullFromCollection(bridge.collection);

    expect(result.fetched).toBe(201);
    expect(bridge.finds).toHaveLength(2);
  });
});

describe('pullBridgeEvents', () => {
  it('does nothing until the bridge connection string is set', async () => {
    const { pullBridgeEvents } = await import('@/app/lib/services/bridge-pull');

    await expect(pullBridgeEvents()).resolves.toEqual({
      configured: false,
      fetched: 0,
      recorded: 0,
      duplicate: 0,
      ignored: 0,
      noStore: 0,
      errors: 0,
    });
    expect(connectDBMock).not.toHaveBeenCalled();
  });
});
