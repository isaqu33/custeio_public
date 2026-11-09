/**
 * @jest-environment node
 */
export {};

// Recording an Alloy webhook delivery: the "Chave" finds the Store, a repeated delivery
// is not recorded twice, and the validation ping records nothing.
const connectDBMock = jest.fn();
const storeFindOneMock = jest.fn();
const eventCreateMock = jest.fn();

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/app/models/stores', () => ({
  __esModule: true,
  default: { findOne: storeFindOneMock },
}));
jest.mock('@/app/models/pos-events', () => ({
  __esModule: true,
  default: { create: eventCreateMock },
}));

const STORE_ID = '665f735a90788d97f5a76322';
const body = JSON.stringify({
  evento: 'novo_pedido',
  loja_id: 18424,
  pedido: { ref: 1, status: 1, itens: [] },
});

function storeLookup(store: unknown) {
  storeFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(store) }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  storeLookup({ _id: STORE_ID, externalId: '18424' });
  eventCreateMock.mockResolvedValue({ _id: 'evt1' });
});

describe('recordAlloyWebhook', () => {
  it('rejects a delivery with no key, or with a key no Store has', async () => {
    const { recordAlloyWebhook } = await import('@/app/lib/services/pos-events');

    await expect(recordAlloyWebhook({ authorization: null, rawBody: body })).resolves.toMatchObject(
      {
        result: 'unauthorized',
      },
    );
    storeLookup(null);
    await expect(
      recordAlloyWebhook({ authorization: 'Bearer wrong', rawBody: body }),
    ).resolves.toMatchObject({ result: 'unauthorized' });
    expect(eventCreateMock).not.toHaveBeenCalled();
  });

  it('finds the Store by the hash of the key and records the classified event', async () => {
    const { recordAlloyWebhook, hashWebhookKey } = await import('@/app/lib/services/pos-events');

    await expect(
      recordAlloyWebhook({ authorization: 'Bearer k1', rawBody: body }),
    ).resolves.toMatchObject({ result: 'recorded' });

    expect(storeFindOneMock.mock.calls[0][0]).toEqual({
      provider: 'alloy',
      webhookKeyHash: hashWebhookKey('k1'),
    });
    expect(eventCreateMock.mock.calls[0][0]).toMatchObject({
      kind: 'new_order',
      externalOrderId: '1',
      statusLabel: 'new',
    });
  });

  it('hands back the event and store ids the order job needs', async () => {
    const { recordAlloyWebhook } = await import('@/app/lib/services/pos-events');

    await expect(
      recordAlloyWebhook({ authorization: 'Bearer k1', rawBody: body }),
    ).resolves.toEqual({ result: 'recorded', eventId: 'evt1', storeId: STORE_ID });
  });

  it('accepts the validation ping without recording anything', async () => {
    const { recordAlloyWebhook } = await import('@/app/lib/services/pos-events');

    await expect(
      recordAlloyWebhook({ authorization: 'Bearer k1', rawBody: '{}' }),
    ).resolves.toMatchObject({ result: 'ignored' });
    expect(eventCreateMock).not.toHaveBeenCalled();
  });

  it('does not record the same delivery twice', async () => {
    eventCreateMock.mockRejectedValue({ code: 11000 });
    const { recordAlloyWebhook } = await import('@/app/lib/services/pos-events');

    await expect(
      recordAlloyWebhook({ authorization: 'Bearer k1', rawBody: body }),
    ).resolves.toMatchObject({ result: 'duplicate' });
  });
});
