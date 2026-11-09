/**
 * @jest-environment node
 */
import Orders from '@/app/models/orders';
import { Types } from 'mongoose';

// Sanitized from the real `alteracao_de_status` webhook captured 2026-10-02
// (docs/features/alloy-api.md): an item with paid and zero-price complements.
function sampleOrder() {
  return {
    storeId: new Types.ObjectId(),
    externalOrderId: '1521',
    channel: 'own',
    externalStatus: 3,
    placedAt: new Date('2026-10-02T22:11:06Z'),
    totalValue: 50.4,
    deliveryFee: 3,
    discountValue: 0,
    items: [
      {
        externalCode: '283',
        name: 'João Smash',
        quantity: 1,
        price: 15,
        modifiers: [
          { externalCode: '575', name: 'Ao Ponto', quantity: 1, price: 0 },
          { externalCode: '152', name: 'Fritas Extra (Saquinho)', quantity: 1, price: 7.5 },
        ],
      },
    ],
  };
}

describe('Orders model', () => {
  it('accepts an order with items and add-ons', async () => {
    const order = new Orders(sampleOrder());
    await expect(order.validate()).resolves.toBeUndefined();
    expect(order.items[0]?.modifiers).toHaveLength(2);
  });

  it('still accepts a legacy order without items', async () => {
    const { items: _items, ...legacy } = sampleOrder();
    const order = new Orders(legacy);
    await expect(order.validate()).resolves.toBeUndefined();
    expect(order.items).toHaveLength(0);
  });

  it('accepts a product the PDV sent with no code, to be matched by name', async () => {
    const data = sampleOrder();
    data.items = [{ ...data.items[0]!, externalCode: '' }];
    const order = new Orders(data);

    await expect(order.validate()).resolves.toBeUndefined();
    expect(order.items[0]?.externalCode).toBe('');
  });

  it('keeps the idempotency key unique per store and external order', () => {
    const unique = Orders.schema
      .indexes()
      .find(([fields]) => 'externalOrderId' in fields && 'storeId' in fields);
    expect(unique?.[1]?.unique).toBe(true);
  });
});
