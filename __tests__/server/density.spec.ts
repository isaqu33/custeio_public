/**
 * @jest-environment node
 */
export {};

import {
  convertMassVolume,
  derivePreparationDensity,
  storedQuantity,
  switchedText,
} from '@/app/lib/density';

describe('convertMassVolume', () => {
  it('converts g ↔ ml with the density, and refuses what has none', () => {
    expect(convertMassVolume(15, 'g', 'ml', 1.15)).toBeCloseTo(13.043, 3);
    expect(convertMassVolume(10, 'ml', 'g', 1.15)).toBeCloseTo(11.5, 5);
    expect(convertMassVolume(7, 'g', 'g', 1.15)).toBe(7);
    expect(convertMassVolume(1, 'un', 'ml', 1.15)).toBeNull();
    expect(convertMassVolume(1, 'g', 'ml', 0)).toBeNull();
  });
});

describe('derivePreparationDensity', () => {
  it('works it out from grams in over millilitres out (the ketchup apimentado)', () => {
    expect(
      derivePreparationDensity('ml', 1000, [
        { quantity: 1150, unit: 'g' },
        { quantity: 0.75, unit: 'ml' },
      ]),
    ).toBe(1.15);
  });

  it('works the other way round: ml in, grams out', () => {
    expect(derivePreparationDensity('g', 920, [{ quantity: 1000, unit: 'ml' }])).toBe(0.92);
  });

  it('guesses nothing when the recipe does not cross units, or leaves a big part unknown', () => {
    expect(derivePreparationDensity('g', 1537, [{ quantity: 1537, unit: 'g' }])).toBeUndefined();
    expect(
      derivePreparationDensity('ml', 1000, [
        { quantity: 700, unit: 'g' },
        { quantity: 300, unit: 'ml' },
      ]),
    ).toBeUndefined();
    expect(
      derivePreparationDensity('ml', 1000, [
        { quantity: 900, unit: 'g' },
        { quantity: 50, unit: 'un' },
      ]),
    ).toBeUndefined();
    expect(derivePreparationDensity('ml', 0, [{ quantity: 1, unit: 'g' }])).toBeUndefined();
  });
});

describe('storedQuantity', () => {
  it('saves in the ingredient unit whatever was typed', () => {
    // 15 g of an ingredient stocked in ml, at 1,15 g/ml
    expect(storedQuantity(15, 'g', 'ml', 1.15)).toBeCloseTo(13.043, 3);
    expect(storedQuantity(13, undefined, 'ml', 1.15)).toBe(13);
    expect(storedQuantity(13, 'ml', 'ml', 1.15)).toBe(13);
    // no density: nothing is converted behind the owner's back
    expect(storedQuantity(15, 'g', 'ml', undefined)).toBe(15);
  });
});

describe('switchedText', () => {
  it('keeps the same amount on screen when the unit is switched', () => {
    expect(switchedText('13', 'ml', 'g', 1.15)).toBe('14.95');
    expect(switchedText('', 'ml', 'g', 1.15)).toBe('');
    expect(switchedText('abc', 'ml', 'g', 1.15)).toBe('abc');
  });
});
