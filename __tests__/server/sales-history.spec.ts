/**
 * @jest-environment node
 */
import {
  buildSalesHistory,
  dateRange,
  localDate,
  type SaleOrder,
  startOfLocalDate,
} from '@/app/lib/sales-history';

// Sales by day, product and channel from the orders: the first brick of any forecast.
const order = (over: Partial<Omit<SaleOrder, 'placedAt'>> & { placedAt: string }): SaleOrder => ({
  channel: 'own',
  totalValue: 50,
  calculatedCost: 15,
  incompleteLineCount: 0,
  items: [{ code: '283', name: 'João Smash', quantity: 1 }],
  ...over,
  placedAt: new Date(over.placedAt),
});

describe('local dates', () => {
  it('reads a date in the PDV local time (UTC-3), not UTC', () => {
    // 01:00 UTC on the 10th is 22:00 of the 9th at the store.
    expect(localDate(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-09');
    expect(localDate(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-10');
  });

  it('starts a date at local midnight, which is 03:00 UTC', () => {
    expect(startOfLocalDate('2026-10-10').toISOString()).toBe('2026-10-10T03:00:00.000Z');
  });

  it('lists the last N local dates, oldest first, ending today', () => {
    expect(dateRange(3, new Date('2026-10-10T15:00:00Z'))).toEqual([
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
    expect(dateRange(2, new Date('2026-10-10T01:00:00Z'))).toEqual(['2026-10-08', '2026-10-09']);
  });
});

describe('buildSalesHistory', () => {
  const dates = ['2026-10-08', '2026-10-09', '2026-10-10'];

  it('counts orders, items and revenue per local day, with every date present', () => {
    const history = buildSalesHistory(
      [
        order({ placedAt: '2026-10-09T22:00:00Z', totalValue: 40 }),
        order({
          placedAt: '2026-10-09T23:00:00Z',
          totalValue: 60,
          items: [{ code: '283', name: 'João Smash', quantity: 2 }],
        }),
        // 01:00 UTC on the 10th is still the 9th at the store
        order({ placedAt: '2026-10-10T01:00:00Z', totalValue: 10 }),
      ],
      dates,
    );

    expect(history.days.map((d) => [d.date, d.orders, d.revenue, d.items])).toEqual([
      ['2026-10-08', 0, 0, 0],
      ['2026-10-09', 3, 110, 4],
      ['2026-10-10', 0, 0, 0],
    ]);
    expect(history.totals).toMatchObject({ orders: 3, items: 4, revenue: 110, avgTicket: 36.67 });
  });

  it('splits by channel and ignores orders outside the range', () => {
    const history = buildSalesHistory(
      [
        order({ placedAt: '2026-10-09T20:00:00Z', channel: 'ifood', totalValue: 30 }),
        order({ placedAt: '2026-10-09T21:00:00Z', channel: 'own', totalValue: 20 }),
        order({ placedAt: '2026-09-01T20:00:00Z', totalValue: 999 }),
      ],
      dates,
    );

    expect(history.days[1]?.byChannel).toEqual({
      ifood: { orders: 1, revenue: 30 },
      own: { orders: 1, revenue: 20 },
    });
    expect(history.totals.orders).toBe(2);
  });

  it('ranks products by quantity sold, keyed by the PDV code and falling back to the name', () => {
    const history = buildSalesHistory(
      [
        order({ placedAt: '2026-10-09T20:00:00Z', items: [{ code: '1', name: 'X', quantity: 3 }] }),
        order({
          placedAt: '2026-10-09T21:00:00Z',
          items: [
            { code: '1', name: 'X', quantity: 2 },
            { code: '', name: 'Combo sem código', quantity: 1 },
          ],
        }),
      ],
      dates,
    );

    expect(history.products.map((p) => [p.key, p.quantity, p.orders])).toEqual([
      ['1', 5, 2],
      ['Combo sem código', 1, 1],
    ]);
  });

  it('computes the margin only over orders whose recipes were all found', () => {
    const history = buildSalesHistory(
      [
        order({ placedAt: '2026-10-09T20:00:00Z', totalValue: 100, calculatedCost: 30 }),
        // incomplete: its cost is a floor, so it must not drag the margin up
        order({
          placedAt: '2026-10-09T21:00:00Z',
          totalValue: 100,
          calculatedCost: 5,
          incompleteLineCount: 1,
        }),
      ],
      dates,
    );

    expect(history.totals.completeOrders).toBe(1);
    expect(history.totals.margin).toBeCloseTo(0.7, 5);
  });

  it('has no margin without a complete order, and averages weekdays over the dates that sold', () => {
    const none = buildSalesHistory(
      [order({ placedAt: '2026-10-09T20:00:00Z', incompleteLineCount: 2 })],
      dates,
    );
    expect(none.totals.margin).toBeNull();

    // 2026-10-09 is a Friday; two Fridays: 3 orders and 1 order → average 2
    const fridays = buildSalesHistory(
      [
        order({ placedAt: '2026-10-09T20:00:00Z' }),
        order({ placedAt: '2026-10-09T21:00:00Z' }),
        order({ placedAt: '2026-10-09T22:00:00Z' }),
        order({ placedAt: '2026-10-02T20:00:00Z' }),
      ],
      ['2026-10-02', '2026-10-09'],
    );
    expect(fridays.weekdays[5]).toMatchObject({ dates: 2, avgOrders: 2 });
    expect(fridays.weekdays[1]).toMatchObject({ dates: 0, avgOrders: 0 });
  });
});
