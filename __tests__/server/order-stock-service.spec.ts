/**
 * @jest-environment node
 */
export {};

// pos.order.received: an order the PDV announced becomes an Orders row and, once accepted, takes its
// recipes out of stock. Idempotent: the same order arrives in several events.
const connectDBMock = jest.fn();
const eventFindByIdMock = jest.fn();
const orderUpdateOneMock = jest.fn();
const orderFindOneMock = jest.fn();
const orderFindMock = jest.fn();
const productFindMock = jest.fn();
const ingredientFindMock = jest.fn();
const ingredientUpdateOneMock = jest.fn();
const movementFindMock = jest.fn();
const loadSharedMock = jest.fn();
const recordSaleMock = jest.fn();
const recordReversalMock = jest.fn();
const deleteMovementMock = jest.fn();

const chain = (result: unknown) => {
  const link: Record<string, unknown> = {};
  for (const step of ['select', 'sort', 'limit']) link[step] = () => link;
  link.lean = () => Promise.resolve(result);
  return link;
};

jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: connectDBMock }));
jest.mock('@/app/models/pos-events', () => ({
  __esModule: true,
  default: { findById: eventFindByIdMock },
}));
jest.mock('@/app/models/orders', () => ({
  __esModule: true,
  default: { updateOne: orderUpdateOneMock, findOne: orderFindOneMock, find: orderFindMock },
}));
jest.mock('@/app/models/partner-products', () => ({
  __esModule: true,
  default: { find: productFindMock },
}));
jest.mock('@/app/models/raw-ingredients', () => ({
  __esModule: true,
  default: { find: ingredientFindMock, updateOne: ingredientUpdateOneMock },
}));
jest.mock('@/app/models/stock-movements', () => ({
  __esModule: true,
  default: { find: movementFindMock },
}));
jest.mock('@/app/lib/services/shared-recipes', () => ({ loadSharedRecipes: loadSharedMock }));
jest.mock('@/app/lib/services/stock-movements', () => ({
  recordSaleMovement: recordSaleMock,
  recordSaleReversalMovement: recordReversalMock,
  deleteMovement: deleteMovementMock,
}));

// An in-memory ledger: what the service writes is what it reads back, like the real collection.
type Row = { rawIngredientId: string; type: 'sale' | 'reversal'; quantity: number; value: number };
let ledger: Row[] = [];

const STORE = '665f735a90788d97f5a76322';
const ANGUS = '665f735a90788d97f5a76a01';
const FRIES = '665f735a90788d97f5a76a02';
const ORDER_ID = '665f735a90788d97f5a76b01';
const EVENT_ID = '665f735a90788d97f5a76c01';

const orderItems = [
  {
    externalCode: '218',
    name: 'Casa Burguer + Fritas',
    quantity: 2,
    modifiers: [
      { externalCode: '575', name: 'Ao Ponto', quantity: 1 },
      { externalCode: '802', name: 'Fritas Combo', quantity: 1 },
    ],
  },
];

function event(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'evt1',
    storeId: STORE,
    kind: 'status_change',
    externalOrderId: '1527',
    statusCode: 2,
    channel: 'didifood',
    order: {
      createdAt: '2026-10-02 20:25:40',
      deliveryFee: 3,
      discount: 10,
      items: [
        {
          quantity: 2,
          price: 37.9,
          codPdv: '218',
          name: 'Casa Burguer + Fritas',
          modifiers: [
            { quantity: 1, price: 0, codPdv: '575', name: 'Ao Ponto' },
            { quantity: 1, price: 0, codPdv: '802', name: 'Fritas Combo' },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function orderDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: ORDER_ID,
    storeId: STORE,
    externalOrderId: '1527',
    stockStatus: 'pending',
    placedAt: new Date('2026-10-02T23:25:40Z'),
    totalValue: 75.8,
    items: orderItems,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  connectDBMock.mockResolvedValue(undefined);
  eventFindByIdMock.mockReturnValue(chain(event()));
  orderUpdateOneMock.mockResolvedValue({});
  orderFindOneMock.mockReturnValue(chain(orderDoc()));
  productFindMock.mockReturnValue(chain([]));
  ingredientFindMock.mockReturnValue(
    chain([
      { _id: ANGUS, averageCost: 3.75 },
      { _id: FRIES, averageCost: 0.02 },
    ]),
  );
  ingredientUpdateOneMock.mockResolvedValue({});
  loadSharedMock.mockImplementation(async (_store: string, kind: string) =>
    kind === 'product'
      ? new Map([['218', [{ rawIngredientId: ANGUS, quantity: 1 }]]])
      : new Map([
          ['802', [{ rawIngredientId: FRIES, quantity: 200 }]],
          ['575', []],
        ]),
  );
  ledger = [];
  movementFindMock.mockImplementation(() => chain(ledger.map((row) => ({ ...row }))));
  recordSaleMock.mockImplementation(
    async (call: { rawIngredientId: string; quantity: number; unitCost: number }) => {
      ledger.push({
        rawIngredientId: call.rawIngredientId,
        type: 'sale',
        quantity: -call.quantity,
        value: call.quantity * call.unitCost,
      });
      return { id: 'mv1' };
    },
  );
  recordReversalMock.mockImplementation(
    async (call: { rawIngredientId: string; quantity: number; unitCost: number }) => {
      ledger.push({
        rawIngredientId: call.rawIngredientId,
        type: 'reversal',
        quantity: call.quantity,
        value: call.quantity * call.unitCost,
      });
      return { id: 'rv1' };
    },
  );
});

describe('processPosEvent — debit', () => {
  it('ignores an event with no order, or one it cannot classify', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    eventFindByIdMock.mockReturnValue(chain(event({ kind: 'unknown' })));
    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({ action: 'ignored' });
    eventFindByIdMock.mockReturnValue(chain(null));
    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({ action: 'ignored' });
    expect(orderUpdateOneMock).not.toHaveBeenCalled();
  });

  it('saves the order and does not debit while it is only "new" (status 1)', async () => {
    eventFindByIdMock.mockReturnValue(chain(event({ kind: 'new_order', statusCode: 1 })));
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({
      action: 'saved',
      externalOrderId: '1527',
    });

    const [filter, update] = orderUpdateOneMock.mock.calls[0];
    expect(filter).toMatchObject({ externalOrderId: '1527' });
    expect(update.$set).toMatchObject({
      channel: 'didifood',
      deliveryFee: 3,
      discountValue: 10,
      totalValue: 75.8, // 2 × 37.90, complements are free
    });
    expect(update.$set.placedAt.toISOString()).toBe('2026-10-02T23:25:40.000Z'); // local time, UTC-3
    expect(update.$max).toEqual({ externalStatus: 1 });
    expect(recordSaleMock).not.toHaveBeenCalled();
  });

  it('debits the recipes of an accepted order, values it at the average cost and sets its margin', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toEqual({
      action: 'debited',
      externalOrderId: '1527',
      calculatedCost: 15.5,
      incomplete: 0,
    });
    // 2 × Casa = 2 Angus; 2 × Fritas Combo = 400 of fries; "Ao Ponto" consumes nothing.
    const sales = recordSaleMock.mock.calls.map(([call]) => [
      call.rawIngredientId,
      call.quantity,
      call.unitCost,
    ]);
    expect(sales).toEqual(
      expect.arrayContaining([
        [ANGUS, 2, 3.75],
        [FRIES, 400, 0.02],
      ]),
    );
    expect(
      ingredientUpdateOneMock.mock.calls.map(([, update]) => update.$inc.currentStock),
    ).toEqual(expect.arrayContaining([-2, -400]));
    const lastUpdate = orderUpdateOneMock.mock.calls.at(-1)?.[1].$set;
    expect(lastUpdate).toMatchObject({
      stockStatus: 'debited',
      calculatedCost: 15.5,
      incompleteLines: [],
    });
    expect(lastUpdate.profitMargin).toBeCloseTo((75.8 - 15.5) / 75.8, 3);
  });

  it('does nothing when the order was already debited, even if another event announces it', async () => {
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited' })));
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({
      action: 'already_debited',
      externalOrderId: '1527',
    });
    expect(recordSaleMock).not.toHaveBeenCalled();
  });

  it('skips an ingredient a previous half-finished run already took out', async () => {
    recordSaleMock.mockResolvedValueOnce('duplicate');
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await processPosEvent(EVENT_ID);

    expect(ingredientUpdateOneMock).toHaveBeenCalledTimes(1); // only the other ingredient moved
  });

  it('takes the movement back when the stock update fails, so a retry can apply it', async () => {
    ingredientUpdateOneMock.mockRejectedValueOnce(new Error('boom'));
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).rejects.toThrow('boom');

    expect(deleteMovementMock).toHaveBeenCalledWith('mv1');
  });

  it('flags a sale with no recipe instead of pretending it cost nothing', async () => {
    loadSharedMock.mockResolvedValue(new Map());
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toMatchObject({ action: 'debited', incomplete: 3 });
    expect(recordSaleMock).not.toHaveBeenCalled();
    const flagged = orderUpdateOneMock.mock.calls.at(-1)?.[1].$set.incompleteLines;
    expect(flagged).toHaveLength(3); // the product and both complements
  });

  it('matches a product the PDV sent with no code by its name', async () => {
    orderFindOneMock.mockReturnValue(
      chain(
        orderDoc({
          items: [{ externalCode: '', name: 'Ester burger + Fritas', quantity: 1, modifiers: [] }],
        }),
      ),
    );
    productFindMock.mockReturnValue(
      chain([{ name: 'Ester Burger + Fritas', recipe: [{ rawIngredientId: ANGUS, quantity: 1 }] }]),
    );
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toMatchObject({ action: 'debited', incomplete: 0 });
    expect(recordSaleMock.mock.calls[0]?.[0]).toMatchObject({
      rawIngredientId: ANGUS,
      quantity: 1,
    });
  });

  it('resolves a complement the PDV sent with no code by its name, through the catalog', async () => {
    // The same "Fritas Combo" is 802 on one order and empty on the next.
    orderFindOneMock.mockReturnValue(
      chain(
        orderDoc({
          items: [
            {
              externalCode: '218',
              name: 'Casa Burguer + Fritas',
              quantity: 1,
              modifiers: [{ externalCode: '', name: 'fritas combo', quantity: 1 }],
            },
          ],
        }),
      ),
    );
    productFindMock.mockReturnValue(
      chain([
        {
          name: 'Casa Burguer + Fritas',
          codPdv: '218',
          modifiers: [{ name: 'Fritas Combo', codPdv: '802' }],
        },
        {
          name: 'Davi Burguer + Fritas',
          codPdv: '510',
          modifiers: [{ name: 'Fritas Combo', codPdv: '802' }],
        },
      ]),
    );
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toMatchObject({ action: 'debited', incomplete: 0 });
    expect(
      recordSaleMock.mock.calls.map(([call]) => [call.rawIngredientId, call.quantity]),
    ).toEqual(expect.arrayContaining([[FRIES, 200]]));
  });

  it('does not guess when a name maps to more than one code', async () => {
    orderFindOneMock.mockReturnValue(
      chain(
        orderDoc({
          items: [
            {
              externalCode: '218',
              name: 'Casa Burguer + Fritas',
              quantity: 1,
              modifiers: [{ externalCode: '', name: 'Molho', quantity: 1 }],
            },
          ],
        }),
      ),
    );
    productFindMock.mockReturnValue(
      chain([
        { name: 'A', codPdv: '1', modifiers: [{ name: 'Molho', codPdv: '10' }] },
        { name: 'B', codPdv: '2', modifiers: [{ name: 'Molho', codPdv: '11' }] },
      ]),
    );
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toMatchObject({ action: 'debited', incomplete: 1 });
  });

  it('resolves a product with no code through its catalog name, then uses the shared recipe', async () => {
    orderFindOneMock.mockReturnValue(
      chain(
        orderDoc({
          items: [
            { externalCode: '', name: 'Casa Burguer + Fritas', quantity: 3, modifiers: [] },
          ],
        }),
      ),
    );
    productFindMock.mockReturnValue(chain([{ name: 'Casa Burguer + Fritas', codPdv: '218' }]));
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await processPosEvent(EVENT_ID);

    expect(recordSaleMock.mock.calls[0]?.[0]).toMatchObject({
      rawIngredientId: ANGUS,
      quantity: 3,
    });
  });

  it('never debits a cancelled order, even if a late status event arrives', async () => {
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'reversed' })));
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({ action: 'ignored' });
    expect(recordSaleMock).not.toHaveBeenCalled();
  });
});

describe('processPosEvent — cancellation', () => {
  beforeEach(() => {
    eventFindByIdMock.mockReturnValue(chain(event({ kind: 'cancellation', statusCode: 5 })));
  });

  it('gives back what a debited order took, once', async () => {
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited' })));
    ledger = [
      { rawIngredientId: ANGUS, type: 'sale', quantity: -2, value: 7.5 },
      { rawIngredientId: FRIES, type: 'sale', quantity: -400, value: 8 },
    ];
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    const result = await processPosEvent(EVENT_ID);

    expect(result).toEqual({ action: 'reversed', externalOrderId: '1527', ingredients: 2 });
    expect(
      ingredientUpdateOneMock.mock.calls.map(([, update]) => update.$inc.currentStock),
    ).toEqual([2, 400]);
    expect(orderUpdateOneMock.mock.calls.at(-1)?.[1]).toEqual({
      $set: { stockStatus: 'reversed' },
    });
  });

  it('does not give the stock back twice', async () => {
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited' })));
    ledger = [{ rawIngredientId: ANGUS, type: 'sale', quantity: -2, value: 7.5 }];
    recordReversalMock.mockResolvedValue('duplicate');
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).resolves.toMatchObject({
      action: 'reversed',
      ingredients: 0,
    });
    expect(ingredientUpdateOneMock).not.toHaveBeenCalled();
  });

  it('marks an order cancelled before its debit so a later status event cannot debit it', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');

    await expect(processPosEvent(EVENT_ID)).resolves.toEqual({
      action: 'cancelled_before_debit',
      externalOrderId: '1527',
    });
    expect(orderUpdateOneMock.mock.calls.at(-1)?.[1]).toEqual({
      $set: { stockStatus: 'reversed' },
    });
    expect(recordSaleMock).not.toHaveBeenCalled();
  });
});

describe('reprocessOrderStock — a recipe added after the order was debited', () => {
  // The order was debited when only the product (Angus) had a recipe: the fries complement was missing.
  beforeEach(() => {
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited', stockRevision: 1 })));
    ledger = [{ rawIngredientId: ANGUS, type: 'sale', quantity: -2, value: 7.5 }];
  });

  it('writes only the difference, under the next revision, and fixes the cost', async () => {
    const { reprocessOrderStock } = await import('@/app/lib/services/order-stock');

    const result = await reprocessOrderStock(STORE, '1527');

    expect(result).toEqual({
      action: 'reprocessed',
      externalOrderId: '1527',
      calculatedCost: 15.5, // 7.5 already + 400 g of fries at 0.02
      incomplete: 0,
      changed: 1,
    });
    // Angus was already taken in full: only the fries move, at revision 2.
    expect(recordSaleMock).toHaveBeenCalledTimes(1);
    expect(recordSaleMock.mock.calls[0]?.[0]).toMatchObject({
      rawIngredientId: FRIES,
      quantity: 400,
      orderRevision: 2,
    });
    expect(ingredientUpdateOneMock).toHaveBeenCalledTimes(1);
    const claim = orderUpdateOneMock.mock.calls[0];
    expect(claim?.[0]).toMatchObject({ stockStatus: 'debited', stockRevision: 1 });
    expect(claim?.[1]).toEqual({ $set: { stockRevision: 2 } });
    expect(orderUpdateOneMock.mock.calls.at(-1)?.[1].$set).toMatchObject({
      calculatedCost: 15.5,
      incompleteLines: [],
    });
  });

  it('gives back the difference when the recipe now asks for less', async () => {
    ledger = [{ rawIngredientId: ANGUS, type: 'sale', quantity: -5, value: 18.75 }]; // took 5, now 2
    const { reprocessOrderStock } = await import('@/app/lib/services/order-stock');

    await reprocessOrderStock(STORE, '1527');

    expect(recordReversalMock.mock.calls[0]?.[0]).toMatchObject({
      rawIngredientId: ANGUS,
      quantity: 3,
      unitCost: 3.75, // at the cost it was taken at
      orderRevision: 2,
    });
    expect(
      ingredientUpdateOneMock.mock.calls.map(([, update]) => update.$inc.currentStock),
    ).toEqual(expect.arrayContaining([3]));
  });

  it('does nothing when the order is not debited, or when another run already took the revision', async () => {
    const { reprocessOrderStock } = await import('@/app/lib/services/order-stock');

    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'pending' })));
    await expect(reprocessOrderStock(STORE, '1527')).resolves.toEqual({ action: 'ignored' });

    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited', stockRevision: 1 })));
    orderUpdateOneMock.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(reprocessOrderStock(STORE, '1527')).resolves.toEqual({
      action: 'already_debited',
      externalOrderId: '1527',
    });
    expect(recordSaleMock).not.toHaveBeenCalled();
  });

  it('reprocesses every debited order of the store that still has incomplete lines', async () => {
    orderFindMock.mockReturnValue(
      chain([{ externalOrderId: '1527' }, { externalOrderId: '1528' }]),
    );
    orderFindOneMock.mockReturnValue(chain(orderDoc({ stockStatus: 'debited', stockRevision: 1 })));
    const { reprocessIncompleteOrders } = await import('@/app/lib/services/order-stock');

    const result = await reprocessIncompleteOrders(STORE);

    expect(result).toEqual({ reprocessed: 2, stillIncomplete: 0 });
    expect(orderFindMock.mock.calls[0]?.[0]).toMatchObject({
      stockStatus: 'debited',
      'incompleteLines.0': { $exists: true },
    });
  });
});
