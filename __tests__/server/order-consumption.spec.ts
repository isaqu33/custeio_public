/**
 * @jest-environment node
 */
import {
  computeOrderConsumption,
  itemsRevenue,
  parseLocalTimestamp,
  type ConsumptionItem,
  type Recipes,
} from '@/app/lib/order-consumption';

// The rules checked on real Alloy orders (docs/features/alloy-api.md): a line's quantity multiplies
// its product and complements, a complement has its own quantity, and the same code can repeat.
const ANGUS = 'angus-150';
const PATTY_SMASH = 'angus-100';
const FRIES = 'fries';
const SAUCE = 'sauce-verde';

const RECIPES = {
  products: new Map<string, Array<{ rawIngredientId: string; quantity: number }>>([
    ['218', [{ rawIngredientId: ANGUS, quantity: 1 }]], // Casa
    ['287', [{ rawIngredientId: PATTY_SMASH, quantity: 3 }]], // Combo Pedro, Tiago e João
  ]),
  modifiers: new Map<string, Array<{ rawIngredientId: string; quantity: number }>>([
    ['802', [{ rawIngredientId: FRIES, quantity: 200 }]], // Fritas Combo
    ['518', [{ rawIngredientId: SAUCE, quantity: 30 }]], // Molho Verde
    ['575', []], // Ao Ponto: consumes nothing, but it is configured
  ]),
};

const recipes: Recipes = {
  product: (item) => RECIPES.products.get(item.externalCode),
  modifier: (modifier) => RECIPES.modifiers.get(modifier.externalCode),
};

const item = (
  code: string,
  name: string,
  quantity: number,
  modifiers: ConsumptionItem['modifiers'] = [],
): ConsumptionItem => ({ externalCode: code, name, quantity, modifiers });
const mod = (code: string, name: string, quantity = 1) => ({ externalCode: code, name, quantity });

describe('computeOrderConsumption', () => {
  it('adds the product recipe and the recipe of each complement', () => {
    const result = computeOrderConsumption(
      [
        item('218', 'Casa', 1, [
          mod('802', 'Fritas Combo'),
          mod('518', 'Molho Verde'),
          mod('575', 'Ao Ponto'),
        ]),
      ],
      recipes,
    );

    expect(Object.fromEntries(result.lines)).toEqual({ [ANGUS]: 1, [FRIES]: 200, [SAUCE]: 30 });
    expect(result.missing).toEqual([]);
  });

  it('multiplies the product and every complement by the line quantity', () => {
    const result = computeOrderConsumption(
      [item('218', 'Casa', 4, [mod('802', 'Fritas Combo'), mod('575', 'Ao Ponto')])],
      recipes,
    );

    expect(Object.fromEntries(result.lines)).toEqual({ [ANGUS]: 4, [FRIES]: 800 });
  });

  it('counts a complement with its own quantity and the same code listed several times', () => {
    // Combo: three burgers, "Molho Verde" listed once per burger, "Fritas Combo" × 3.
    const result = computeOrderConsumption(
      [
        item('287', 'Combo Pedro, Tiago e João', 1, [
          mod('518', 'Molho Verde'),
          mod('518', 'Molho Verde'),
          mod('518', 'Molho Verde'),
          mod('802', 'Fritas Combo', 3),
        ]),
      ],
      recipes,
    );

    expect(Object.fromEntries(result.lines)).toEqual({
      [PATTY_SMASH]: 3,
      [SAUCE]: 90,
      [FRIES]: 600,
    });
  });

  it('flags a product or complement with no recipe, once, and takes nothing for it', () => {
    const result = computeOrderConsumption(
      [
        item('999', 'Adão Burguer', 2, [mod('777', 'Bacon extra'), mod('777', 'Bacon extra')]),
        item('218', 'Casa', 1),
      ],
      recipes,
    );

    expect(Object.fromEntries(result.lines)).toEqual({ [ANGUS]: 1 });
    expect(result.missing).toEqual([
      { kind: 'product', codPdv: '999', name: 'Adão Burguer' },
      { kind: 'modifier', codPdv: '777', name: 'Bacon extra' },
    ]);
  });

  it('treats a product whose recipe is empty as missing, and an empty complement as an answer', () => {
    RECIPES.products.set('500', []);
    const result = computeOrderConsumption(
      [item('500', 'Sem ficha', 1, [mod('575', 'Ao Ponto')])],
      recipes,
    );

    expect(result.lines.size).toBe(0);
    expect(result.missing).toEqual([{ kind: 'product', codPdv: '500', name: 'Sem ficha' }]);
    RECIPES.products.delete('500');
  });

  it('drops float dust from the sums', () => {
    RECIPES.modifiers.set('x', [{ rawIngredientId: 'a', quantity: 0.1 }]);
    const result = computeOrderConsumption([item('218', 'Casa', 1, [mod('x', 'X', 3)])], recipes);

    expect(result.lines.get('a')).toBe(0.3);
    RECIPES.modifiers.delete('x');
  });
});

describe('itemsRevenue', () => {
  it('uses the unit price times the quantity, complements included', () => {
    expect(
      itemsRevenue([
        {
          price: 15,
          quantity: 1,
          modifiers: [
            { price: 7.5, quantity: 1 },
            { price: 0, quantity: 1 },
          ],
        },
        { price: 27.9, quantity: 4, modifiers: [] },
      ]),
    ).toBe(134.1); // 22.5 + 111.6
  });
});

describe('parseLocalTimestamp', () => {
  it("reads the PDV's naive local time as America/Sao_Paulo (UTC-3)", () => {
    expect(parseLocalTimestamp('2026-10-02 20:14:06')?.toISOString()).toBe(
      '2026-10-02T23:14:06.000Z',
    );
    expect(parseLocalTimestamp(undefined)).toBeUndefined();
    expect(parseLocalTimestamp('not a date')).toBeUndefined();
  });
});
