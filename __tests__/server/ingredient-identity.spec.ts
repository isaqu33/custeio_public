/**
 * @jest-environment node
 */
import {
  foldText,
  MAX_ALIASES,
  MAX_BARCODES,
  normalizeAliases,
  normalizeBarcodes,
  normalizePurchasePack,
} from '@/app/lib/ingredient-identity';

// The nicknames, barcodes and pack of an ingredient: how a message or a receipt line finds it.
describe('foldText', () => {
  it('drops accents and case, and collapses spaces', () => {
    expect(foldText('  Pão   BRIOCHE ')).toBe('pao brioche');
  });
});

describe('normalizeAliases', () => {
  it('cleans spaces, drops empties and repeats (accent and case insensitive)', () => {
    expect(
      normalizeAliases(['  Carne ', 'carne', 'CARNE', 'Blend  Angus', '', '   '], 'Angus 150 g'),
    ).toEqual(['Carne', 'Blend Angus']);
    expect(normalizeAliases(['Pão', 'pao'], 'Brioche')).toEqual(['Pão']);
  });

  it('never repeats the ingredient name itself', () => {
    expect(normalizeAliases(['Bacon', 'bacon fatiado'], 'bacon')).toEqual(['bacon fatiado']);
  });

  it('keeps at most the limit and cuts a long nickname', () => {
    const many = Array.from({ length: 30 }, (_, i) => `apelido ${i}`);
    expect(normalizeAliases(many, 'x')).toHaveLength(MAX_ALIASES);
    expect(normalizeAliases(['a'.repeat(100)], 'x')[0]).toHaveLength(40);
  });
});

describe('normalizeBarcodes', () => {
  it('keeps digits only, 8 to 14 of them, without repeats', () => {
    expect(
      normalizeBarcodes(['7894900011272', '7894 9000 11272', '123', 'abc', '07891991012874']),
    ).toEqual(['7894900011272', '07891991012874']);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => String(78949000000 + i).padStart(13, '0'));
    expect(normalizeBarcodes(many)).toHaveLength(MAX_BARCODES);
  });
});

describe('normalizePurchasePack', () => {
  it('keeps a positive quantity with a clean label', () => {
    expect(normalizePurchasePack({ label: '  Fardo   12 un ', quantity: 12 })).toEqual({
      label: 'Fardo 12 un',
      quantity: 12,
    });
    expect(normalizePurchasePack({ quantity: 1600.0004 })).toEqual({ quantity: 1600 });
  });

  it('is null when there is nothing worth keeping', () => {
    expect(normalizePurchasePack(null)).toBeNull();
    expect(normalizePurchasePack(undefined)).toBeNull();
    expect(normalizePurchasePack({ quantity: 0 })).toBeNull();
    expect(normalizePurchasePack({ quantity: Number.NaN })).toBeNull();
  });
});
