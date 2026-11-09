/**
 * @jest-environment node
 */
import { computePriceReport, type PurchaseRow } from '@/app/lib/price-report';

const NOW = new Date('2026-10-10T12:00:00Z');
const day = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);

const row = (over: Partial<PurchaseRow> & { daysAgo: number }): PurchaseRow => ({
  ingredientId: 'mayo',
  occurredAt: day(over.daysAgo),
  quantity: 1600,
  unitCost: 0.02,
  supplierKey: 'A',
  supplierName: 'Fornecedor A',
  ...over,
});

describe('computePriceReport — changes', () => {
  it('compares the latest purchase with the previous one of the SAME supplier, in R$ first', () => {
    const report = computePriceReport(
      [
        row({ daysAgo: 60, unitCost: 0.0225 }),
        row({ daysAgo: 10, unitCost: 0.0243, quantity: 9600 }),
        // another supplier does not change what supplier A did
        row({ daysAgo: 5, unitCost: 0.03, supplierKey: 'B', supplierName: 'Fornecedor B' }),
      ],
      { now: NOW },
    );

    expect(report.changes).toHaveLength(1);
    const [change] = report.changes;
    expect(change?.supplierName).toBe('Fornecedor A');
    expect(change?.percent).toBeCloseTo(8, 1);
    expect(change?.extraPaid).toBeCloseTo((0.0243 - 0.0225) * 9600, 4);
    expect(change?.previous.unitCost).toBe(0.0225);
  });

  it('ignores small moves, single purchases and changes older than the window', () => {
    const report = computePriceReport(
      [
        row({ ingredientId: 'small', daysAgo: 40, unitCost: 1.0 }),
        row({ ingredientId: 'small', daysAgo: 10, unitCost: 1.03 }), // 3 %
        row({ ingredientId: 'single', daysAgo: 10, unitCost: 5 }),
        row({ ingredientId: 'old', daysAgo: 300, unitCost: 1 }),
        row({ ingredientId: 'old', daysAgo: 200, unitCost: 2 }), // latest is out of the window
      ],
      { now: NOW },
    );
    expect(report.changes).toEqual([]);
  });

  it('reports a price drop as a negative amount and orders by the money involved', () => {
    const report = computePriceReport(
      [
        row({ ingredientId: 'cheese', daysAgo: 50, unitCost: 0.04, quantity: 1000 }),
        row({ ingredientId: 'cheese', daysAgo: 5, unitCost: 0.03, quantity: 1000 }), // −10 R$
        row({ ingredientId: 'bacon', daysAgo: 50, unitCost: 0.05, quantity: 100 }),
        row({ ingredientId: 'bacon', daysAgo: 5, unitCost: 0.06, quantity: 100 }), // +1 R$
      ],
      { now: NOW },
    );

    expect(report.changes.map((c) => c.ingredientId)).toEqual(['cheese', 'bacon']);
    expect(report.changes[0]?.extraPaid).toBeCloseTo(-10, 4);
    expect(report.changes[0]?.percent).toBeCloseTo(-25, 1);
  });

  it('skips rows without a usable cost', () => {
    const report = computePriceReport(
      [row({ daysAgo: 30, unitCost: 0 }), row({ daysAgo: 5, unitCost: 0.03 })],
      { now: NOW },
    );
    expect(report.changes).toEqual([]);
  });
});

describe('computePriceReport — comparison between suppliers', () => {
  it('lists each supplier latest price, cheapest first, with the spread', () => {
    const report = computePriceReport(
      [
        row({ daysAgo: 20, unitCost: 0.0225, supplierKey: 'A', supplierName: 'Loja Santa Maria' }),
        row({ daysAgo: 70, unitCost: 0.02, supplierKey: 'A', supplierName: 'Loja Santa Maria' }),
        row({ daysAgo: 12, unitCost: 0.0243, supplierKey: 'B', supplierName: 'Atacadão' }),
      ],
      { now: NOW },
    );

    expect(report.comparisons).toHaveLength(1);
    const [comparison] = report.comparisons;
    expect(comparison?.prices.map((p) => p.supplierName)).toEqual(['Loja Santa Maria', 'Atacadão']);
    expect(comparison?.prices[0]?.unitCost).toBe(0.0225); // the latest of A, not its older price
    expect(comparison?.spreadPercent).toBeCloseTo(8, 1);
  });

  it('needs two suppliers bought from recently', () => {
    const report = computePriceReport(
      [
        row({ daysAgo: 20, supplierKey: 'A' }),
        row({ daysAgo: 400, supplierKey: 'B', supplierName: 'Fornecedor B', unitCost: 0.05 }),
      ],
      { now: NOW },
    );
    expect(report.comparisons).toEqual([]);
  });
});
