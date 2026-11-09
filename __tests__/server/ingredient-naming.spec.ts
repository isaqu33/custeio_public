/**
 * @jest-environment node
 */
export {};

// Names and kinds guessed from what a supplier typed on an NFe. The cases are
// real descriptions from a 24-invoice batch of a hamburger place.
describe('cleanIngredientName', () => {
  it.each([
    ['ACUCAR CRISTAL BRASILIA 5KG UN', 'Acucar Cristal Brasilia 5kg'],
    ['ACUCAR CRISTAL PEROLA 5KG UN0-5KG', 'Acucar Cristal Perola 5kg'],
    ['ACUCAR CRISTAL PEROLA 2KG UN01-2KG', 'Acucar Cristal Perola 2kg'],
    ['MAIONESE HELLMANNS BAG 2,8KG UN01UN', 'Maionese Hellmanns Bag 2,8kg'],
    ['OLEO DE SOJA LIZA PET 900ML UN01UN', 'Oleo De Soja Liza Pet 900ml'],
    ['LUVA BOMPACK LATEX AMARELA M UN UN01UN', 'Luva Bompack Latex Amarela M'],
    [
      'PAPEL HIG DUETTO FD NEUTRO 20M 12 ROLOS UN-12ROLOS',
      'Papel Hig Duetto Fd Neutro 20m 12 Rolos',
    ],
  ])('drops the supplier unit suffix: %s', async (raw, expected) => {
    const { cleanIngredientName } = await import('@/app/lib/ingredient-naming');

    expect(cleanIngredientName(raw)).toBe(expected);
  });

  it.each([
    ['OVOS BCO GD PVC JOSIDITH 30 UN UN', 'Ovos Bco Gd Pvc Josidith 30 Un'],
    [
      'PAPEL P/ LANCHE COM PELICULA 36X45 PLUMA CX 500 UN',
      'Papel P/ Lanche Com Pelicula 36x45 Pluma Cx 500 Un',
    ],
    ['ESPONJA M USO LIMPPANO SUPER WISH 4UN UN', 'Esponja M Uso Limppano Super Wish 4un'],
  ])('keeps a real count ("30 UN"): %s', async (raw, expected) => {
    const { cleanIngredientName } = await import('@/app/lib/ingredient-naming');

    expect(cleanIngredientName(raw)).toBe(expected);
  });

  it('does not strip a word that merely starts with "un"', async () => {
    const { cleanIngredientName } = await import('@/app/lib/ingredient-naming');

    expect(cleanIngredientName('PASTA UNTAVEL')).toBe('Pasta Untavel');
    expect(cleanIngredientName('CAFE UNICO')).toBe('Cafe Unico');
  });

  it('never returns an empty name for a lone token, and collapses spaces', async () => {
    const { cleanIngredientName } = await import('@/app/lib/ingredient-naming');

    expect(cleanIngredientName('UN')).toBe('Un');
    expect(cleanIngredientName('  QUEIJO   MUSSARELA  ')).toBe('Queijo Mussarela');
  });
});

describe('suggestIngredientKind', () => {
  it.each([
    ['LIMP VEJA COZINHA 400ML RF LARANJA UN', 'cleaning'],
    ['DET LIQ YPE NEUTRO 500ML UN', 'cleaning'],
    ['AGUA SANITARIA ZUPP 1L UN', 'cleaning'],
    ['INS BAYGON MULT EUCALIPTO 360ML UN', 'cleaning'],
    ['ESPONJA M USO LIMPPANO SUPER WISH 4UN UN', 'cleaning'],
    ['TOALHA DE PAPEL SOC CLEAN 02X50 TOALHAS UN', 'cleaning'],
    ['ALCOOL GEL 70% DERMACREAM FR 500ML ALOE VERA', 'cleaning'],
    ['GUARDANAPO SANTEPEL 33X30CM 50UN UN01UN', 'packaging'],
    ['SACOLA PLAST BIODEGRADAVEL 60X70CM UN01UN', 'packaging'],
    ['PAPEL P/ LANCHE COM PELICULA 36X45 PLUMA CX 500 UN', 'packaging'],
    ['ALUMINIO WYDA ROLO 4.0X0.30 UN', 'packaging'],
    ['SEDA SERUM+OLEO TOQUE DE SEDA 60ML UN', 'other'],
    ['DESOD LEITE DE ROSAS TRAD 170ML UN', 'other'],
    ['CR DENT SOR 140G TRIPLA LIMPEZA COMPLETA UN', 'other'],
    ['LUVA BOMPACK LATEX AMARELA M UN UN01UN', 'other'],
    ['BOBINA P/ CUPOM FISCAL 80X30 UN', 'other'],
  ])('%s -> %s', async (description, kind) => {
    const { suggestIngredientKind } = await import('@/app/lib/ingredient-naming');

    expect(suggestIngredientKind(description)).toBe(kind);
  });

  it.each([
    'ACUCAR CRISTAL BRASILIA 5KG UN',
    'BATATA CONG UAI 2KG PALITO UN', // "palito" is fries, not a toothpick
    'VINAGRE CASTELO ALCOOL ALHO 750ML UN', // "alcool" alone is food here
    'CATCHUP SACHE 144X7G HEINZ',
    'REFR COCA COLA 220ML LATA UN01UN',
    'QUEIJO MUSSARELA FAT PIRACANJUBA 300G UN',
    'OVOS BCO GD PVC JOSIDITH 30 UN UN',
    'COXA SOBRECOXA A PASSARINHO SADIA 1KG UN',
  ])('leaves food as food: %s', async (description) => {
    const { suggestIngredientKind } = await import('@/app/lib/ingredient-naming');

    expect(suggestIngredientKind(description)).toBe('food');
  });

  it('counts food and packaging as operational, the rest not', async () => {
    const { OPERATIONAL_KINDS } = await import('@/app/lib/ingredient-naming');

    expect([...OPERATIONAL_KINDS]).toEqual(['food', 'packaging']);
  });
});

describe('isInOperation', () => {
  it('follows the kind when nobody decided', async () => {
    const { isInOperation } = await import('@/app/lib/ingredient-naming');
    expect(isInOperation({ kind: 'food' })).toBe(true);
    expect(isInOperation({})).toBe(true);
    expect(isInOperation({ kind: 'cleaning' })).toBe(false);
  });

  it('lets an explicit decision win over the kind', async () => {
    const { isInOperation } = await import('@/app/lib/ingredient-naming');
    expect(isInOperation({ kind: 'cleaning', inOperation: true })).toBe(true);
    expect(isInOperation({ kind: 'food', inOperation: false })).toBe(false);
  });
});

describe('operationState', () => {
  it('lets an explicit decision win, then the kind, then whether it was reviewed', async () => {
    const { operationState } = await import('@/app/lib/ingredient-naming');
    expect(operationState({ kind: 'food', inOperation: false, isDraft: true }, true)).toBe('out');
    expect(operationState({ kind: 'cleaning', inOperation: true }, false)).toBe('in');
    expect(operationState({ kind: 'cleaning', isDraft: true }, true)).toBe('out');
    // An invoice draft nobody reviewed is unconfirmed — until a recipe uses it.
    expect(operationState({ kind: 'food', isDraft: true }, false)).toBe('unconfirmed');
    expect(operationState({ kind: 'food', isDraft: true }, true)).toBe('in');
    expect(operationState({ kind: 'packaging', isDraft: false }, false)).toBe('in');
    expect(operationState({}, false)).toBe('in');
  });
});
