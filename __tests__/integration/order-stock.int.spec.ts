/**
 * Integration test: the main flow of the product against a REAL MongoDB
 * (Testcontainers), with nothing mocked.
 *
 *   POS event ──▶ order ──▶ recipe ──▶ ingredient consumption ──▶ stock + cost
 *
 * Unit tests mock the models, so they cannot catch a wrong query, a missing
 * index or a schema that silently drops a field. This one does.
 */
import mongoose from 'mongoose';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';

let container: StartedMongoDBContainer;

const storeId = new mongoose.Types.ObjectId();

async function seedKitchen() {
  const { default: connectDB } = await import('@/app/lib/connect-db');
  await connectDB();
  const { default: RawIngredientDB } = await import('@/app/models/raw-ingredients');
  const { default: ProductRecipeDB } = await import('@/app/models/product-recipes');

  // Beef at R$ 0.04/g, buns at R$ 1.00 each.
  const beef = await RawIngredientDB.create({
    storeId,
    name: 'Carne',
    unit: 'g',
    currentStock: 10_000,
    averageCost: 0.04,
  });
  const bun = await RawIngredientDB.create({
    storeId,
    name: 'Pão',
    unit: 'un',
    currentStock: 100,
    averageCost: 1,
  });
  // PDV product "218": 150 g of beef and one bun per unit sold.
  await ProductRecipeDB.create({
    storeId,
    kind: 'product',
    codPdv: '218',
    recipe: [
      { rawIngredientId: beef._id, quantity: 150 },
      { rawIngredientId: bun._id, quantity: 1 },
    ],
  });
  return { beef, bun };
}

type EventKind = 'new_order' | 'status_change' | 'cancellation';

async function postEvent(
  overrides: Partial<{ kind: EventKind; statusCode: number; dedupeKey: string; items: unknown[] }>,
) {
  const { default: PosEventDB } = await import('@/app/models/pos-events');
  return PosEventDB.create({
    storeId,
    kind: overrides.kind ?? 'new_order',
    statusCode: overrides.statusCode ?? 2,
    externalOrderId: '9001',
    dedupeKey: overrides.dedupeKey ?? `evt-${Date.now()}-${Math.random()}`,
    order: {
      createdAt: '2026-11-09 12:00:00',
      items: overrides.items ?? [{ codPdv: '218', name: 'X-Burguer', quantity: 2, price: 30 }],
    },
  });
}

async function stockOf(name: string) {
  const { default: RawIngredientDB } = await import('@/app/models/raw-ingredients');
  const doc = await RawIngredientDB.findOne({ storeId, name }).lean();
  return doc?.currentStock;
}

beforeAll(async () => {
  container = await new MongoDBContainer('mongo:6.0').start();
  process.env.DATABASE_URL = `${container.getConnectionString()}/custeio_int?directConnection=true`;
  await seedKitchen();
});

afterAll(async () => {
  await mongoose.disconnect();
  await container?.stop();
});

describe('sale → stock (real MongoDB)', () => {
  it('debits the recipe of an accepted order and values the sale at cost', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');
    const event = await postEvent({});

    const result = await processPosEvent(String(event._id));

    // 2 × (150 g × R$ 0.04 + 1 bun × R$ 1.00) = R$ 14.00 of cost on R$ 60.00 of sales.
    expect(result).toMatchObject({
      action: 'debited',
      externalOrderId: '9001',
      calculatedCost: 14,
      incomplete: 0,
    });
    expect(await stockOf('Carne')).toBe(9_700);
    expect(await stockOf('Pão')).toBe(98);

    const { default: OrderDB } = await import('@/app/models/orders');
    const order = await OrderDB.findOne({ storeId, externalOrderId: '9001' }).lean();
    expect(order).toMatchObject({ stockStatus: 'debited', calculatedCost: 14, totalValue: 60 });
    // (60 − 14) / 60
    expect(order?.profitMargin).toBeCloseTo(0.7667, 4);
  });

  it('is idempotent: another event for the same order takes nothing more', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');
    const again = await postEvent({ kind: 'status_change', statusCode: 3 });

    const result = await processPosEvent(String(again._id));

    expect(result).toMatchObject({ action: 'already_debited', externalOrderId: '9001' });
    expect(await stockOf('Carne')).toBe(9_700);
    expect(await stockOf('Pão')).toBe(98);
  });

  it('gives the stock back when the order is cancelled', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');
    const cancel = await postEvent({ kind: 'cancellation', statusCode: 5 });

    const result = await processPosEvent(String(cancel._id));

    expect(result).toMatchObject({ action: 'reversed', externalOrderId: '9001' });
    expect(await stockOf('Carne')).toBe(10_000);
    expect(await stockOf('Pão')).toBe(100);

    const { default: OrderDB } = await import('@/app/models/orders');
    const order = await OrderDB.findOne({ storeId, externalOrderId: '9001' }).lean();
    expect(order?.stockStatus).toBe('reversed');
  });

  it('flags a product with no recipe instead of pretending it cost nothing', async () => {
    const { processPosEvent } = await import('@/app/lib/services/order-stock');
    const { default: PosEventDB } = await import('@/app/models/pos-events');
    const event = await PosEventDB.create({
      storeId,
      kind: 'new_order',
      statusCode: 2,
      externalOrderId: '9002',
      dedupeKey: 'evt-no-recipe',
      order: {
        createdAt: '2026-11-09 12:05:00',
        items: [{ codPdv: '999', name: 'Prato sem ficha', quantity: 1, price: 25 }],
      },
    });

    const result = await processPosEvent(String(event._id));

    expect(result).toMatchObject({ action: 'debited', incomplete: 1 });
    const { default: OrderDB } = await import('@/app/models/orders');
    const order = await OrderDB.findOne({ storeId, externalOrderId: '9002' }).lean();
    expect(order?.incompleteLines).toHaveLength(1);
    // Nothing else left the shelves.
    expect(await stockOf('Carne')).toBe(10_000);
  });
});
