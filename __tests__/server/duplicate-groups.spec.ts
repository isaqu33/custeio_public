/**
 * @jest-environment node
 */
import { consolidateDuplicateGroups, drinkKey, packSizeOf } from '@/app/lib/duplicate-groups';

const proposal = (keep: string, merge: string[], over = {}) => ({
  keep,
  merge,
  confidence: 'high' as const,
  reason: 'r',
  shouldMerge: true,
  ...over,
});

describe('drinkKey', () => {
  it('reads size and sugar, and ignores what is not a drink', () => {
    expect(drinkKey('Refr Coca Cola 310ml Lt')).toBe('0.31l|regular');
    expect(drinkKey('Refri Coca Cola Lt 310ml Z/acuc')).toBe('0.31l|zero');
    expect(drinkKey('Refri Ant Guarana Pet 1.5l')).toBe('1.5l|regular');
    expect(drinkKey('Ref.coca Cola S/a Lata Sleek')).toBe('unknown-size');
    expect(drinkKey('Tomate Italiano Kg')).toBeNull();
  });
});

describe('consolidateDuplicateGroups', () => {
  it('drops low confidence and the ones the AI itself says not to merge', () => {
    expect(
      consolidateDuplicateGroups([
        proposal('A Bacon', ['B Bacon'], { confidence: 'low' }),
        proposal('Sal X', ['Sal Y'], { shouldMerge: false }),
      ]),
    ).toEqual([]);
  });

  it('never merges drinks of another size or sugar', () => {
    const groups = consolidateDuplicateGroups([
      proposal('Refr Coca Cola 310ml Lt', [
        'Refr Coca Cola 220ml Lata',
        'Refri Coca Cola Lt 310ml Z/acuc',
        'Refri Coca Cola Lt 310ml',
      ]),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        keep: 'Refr Coca Cola 310ml Lt',
        merge: ['Refri Coca Cola Lt 310ml'],
      }),
    ]);
  });

  it('unites groups that share an ingredient and keeps the most proposed one', () => {
    const groups = consolidateDuplicateGroups([
      proposal('Maionese Bag 1,6kg', ['Maionese Pc 1.6kg']),
      proposal('Maionese Bag 1,6kg', ['Maionese Doypack 1kg'], { confidence: 'medium' }),
      proposal('Maionese Doypack 1kg', ['Maionese Bag 2,8kg']),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ keep: 'Maionese Bag 1,6kg', confidence: 'medium' });
    expect(groups[0]?.merge).toEqual([
      'Maionese Bag 2,8kg',
      'Maionese Doypack 1kg',
      'Maionese Pc 1.6kg',
    ]);
  });
});

describe('packSizeOf', () => {
  it('reads weight, volume and counts from the name', () => {
    expect(packSizeOf('Leite Po Int Itambe Pc 400g')).toBe(400);
    expect(packSizeOf('Acucar Cristal Perola 5kg')).toBe(5000);
    expect(packSizeOf('Oleo De Soja Liza Pet 900ml')).toBe(900);
    expect(packSizeOf('Ovos Iana Ext Brancos C/20')).toBe(20);
    expect(packSizeOf('Ovo 30uni Josidith Pet Bco')).toBe(30);
    expect(packSizeOf('Tomate Italiano Uniao Kg')).toBeNull();
  });
});

describe('convertFirst', () => {
  const unitOf = (name: string) =>
    name.includes('Pepino Fornello') ? 'un' : name.endsWith('g') ? 'g' : 'un';

  it('flags different units and un packs of different sizes, and leaves the rest ready', () => {
    const groups = consolidateDuplicateGroups(
      [
        proposal('Pepino Jureia 300g', ['Pepino Fornello Pouch']),
        proposal('Leite Po 400 un', ['Leite Po 300 un']),
        proposal('Ovos 30un', ['Ovos Mantiqueira 30un']),
        proposal('Oleo 900ml un', ['Oleo Vitaliv Pet un']),
      ],
      unitOf,
    );
    expect(groups.map((g) => [g.keep, g.convertFirst])).toEqual([
      ['Pepino Jureia 300g', 'unidades diferentes'],
      ['Leite Po 400 un', 'embalagens de tamanhos diferentes contadas em "un"'],
      ['Ovos 30un', undefined],
      ['Oleo 900ml un', undefined],
    ]);
  });
});
