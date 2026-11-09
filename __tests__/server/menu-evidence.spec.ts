/**
 * @jest-environment node
 */
import { menuEvidenceFor, significantTokens } from '@/app/lib/menu-evidence';

const MENU = [
  { label: 'X-Bacon', type: 'product' as const },
  { label: 'Bacon', type: 'modifier' as const },
  { label: 'Bacon', type: 'modifier' as const },
  { label: 'Combo Sansão', type: 'product' as const },
  { label: 'Queijo Prato', type: 'modifier' as const },
];

describe('menuEvidenceFor', () => {
  it('finds the menu lines that share a word with the ingredient, once each', () => {
    const found = menuEvidenceFor('Bacon Fatiado Meia Manta 1kg', MENU);
    expect(found.map((e) => e.label).sort()).toEqual(['Bacon', 'X-Bacon']);
  });

  it('finds nothing for something the menu never mentions', () => {
    expect(menuEvidenceFor('Mamão Formosa kg', MENU)).toEqual([]);
  });

  it('matches plurals and ignores numbers, units and filler', () => {
    expect(significantTokens('Queijos Pratos 500g PCT')).toEqual(['queijo', 'prato']);
    expect(menuEvidenceFor('Queijos Pratos 500g', MENU).map((e) => e.label)).toEqual([
      'Queijo Prato',
    ]);
  });

  it('caps the number of lines', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: `Bacon ${i}`,
      type: 'product' as const,
    }));
    expect(menuEvidenceFor('Bacon', many, 5)).toHaveLength(5);
  });
});
