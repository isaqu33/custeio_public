/**
 * @jest-environment node
 */
export {};

// How quantities and costs are SHOWN — storage stays in g, ml, un.
describe('formatQuantity', () => {
  it.each([
    [5000, 'g', '5 kg'],
    [2000, 'g', '2 kg'],
    [1500, 'g', '1,5 kg'],
    [999, 'g', '999 g'],
    [250.5, 'g', '250,5 g'],
    [0, 'g', '0 g'],
    [1000, 'ml', '1 L'],
    [1500, 'ml', '1,5 L'],
    [350, 'ml', '350 ml'],
    [12, 'un', '12 un'],
    [-2500, 'g', '-2,5 kg'],
    [1234567, 'g', '1.234,567 kg'],
  ] as const)('%p %s -> %s', async (value, unit, expected) => {
    const { formatQuantity } = await import('@/app/lib/quantity-format');

    expect(formatQuantity(value, unit)).toBe(expected);
  });
});

describe('formatUnitCost', () => {
  it.each([
    [0.002498, 'g', 'R$ 2,50 / kg'],
    [0.0049, 'ml', 'R$ 4,90 / L'],
    [1.29, 'un', 'R$ 1,29 / un'],
    [0.0000012, 'g', 'R$ 0,0012 / kg'],
    [0, 'g', 'R$ 0,00 / kg'],
  ] as const)('%p per %s -> %s', async (cost, unit, expected) => {
    const { formatUnitCost } = await import('@/app/lib/quantity-format');

    expect(formatUnitCost(cost, unit).replace(/\u00a0/g, ' ')).toBe(expected);
  });
});

describe('display units', () => {
  it('converts what a person types (kg, L) into what is stored (g, ml), and back', async () => {
    const { fromDisplayQuantity, toDisplayQuantity } = await import('@/app/lib/quantity-format');

    expect(fromDisplayQuantity(5, 'g')).toBe(5000);
    expect(fromDisplayQuantity(1.5, 'ml')).toBe(1500);
    expect(fromDisplayQuantity(12, 'un')).toBe(12);
    expect(toDisplayQuantity(5000, 'g')).toBe(5);
    // Float dust from the multiplication never reaches the database.
    expect(fromDisplayQuantity(0.1 + 0.2, 'g')).toBe(300);
  });

  it('rounds a cost to 8 decimals so the weighted average carries no float noise', async () => {
    const { roundCost } = await import('@/app/lib/quantity-format');

    expect(roundCost(0.0024980000000000002)).toBe(0.002498);
    expect(roundCost(12.49 / 5000)).toBe(0.002498);
  });
});
