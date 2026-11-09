/**
 * @jest-environment node
 */
import { CASES, INGREDIENTS, PRODUCTS, REPLY_CASES, TOOLS } from '@/scripts/dev/ai-eval-cases';
import { gradeAnswer, gradeReply, numbersIn } from '@/scripts/dev/ai-eval-grade';

// The grader of the assistant test bench decides pass/fail with plain rules, so it must be right.
const byId = (id: string) => CASES.find((c) => c.id === id)!;

describe('gradeAnswer', () => {
  it('passes the right function with the right argument, ignoring case and accents', () => {
    expect(
      gradeAnswer(byId('stock-5'), [{ name: 'get_stock', input: { ingredient: 'pao brioche' } }])
        .pass,
    ).toBe(true);
  });

  it('fails a wrong function, a wrong argument and a missing call', () => {
    expect(
      gradeAnswer(byId('stock-1'), [
        { name: 'get_ingredient_cost', input: { ingredient: 'Angus 150 g' } },
      ]).pass,
    ).toBe(false);
    expect(
      gradeAnswer(byId('stock-1'), [{ name: 'get_stock', input: { ingredient: 'Bacon' } }]).pass,
    ).toBe(false);
    expect(gradeAnswer(byId('stock-1'), []).pass).toBe(false);
  });

  it('checks numbers: a limit, and the quantity converted to the catalog unit', () => {
    expect(
      gradeAnswer(byId('sales-6'), [
        { name: 'get_top_products', input: { period: 'month', limit: 5 } },
      ]).pass,
    ).toBe(true);
    expect(
      gradeAnswer(byId('sales-6'), [
        { name: 'get_top_products', input: { period: 'month', limit: 10 } },
      ]).pass,
    ).toBe(false);

    const right = {
      reason: 'employee',
      person: 'Marcos',
      items: [{ ingredient: 'Batata McCain', quantity: 2000 }],
    };
    expect(
      gradeAnswer(byId('write-1'), [{ name: 'propose_internal_use', input: right }]).pass,
    ).toBe(true);
    const unconverted = { ...right, items: [{ ingredient: 'Batata McCain', quantity: 2 }] };
    expect(
      gradeAnswer(byId('write-1'), [{ name: 'propose_internal_use', input: unconverted }]).pass,
    ).toBe(false);
  });

  it('wants no call when the message is ambiguous or out of scope', () => {
    expect(gradeAnswer(byId('ask-1'), []).pass).toBe(true);
    expect(gradeAnswer(byId('out-1'), []).pass).toBe(true);
    expect(
      gradeAnswer(byId('ask-2'), [{ name: 'get_stock', input: { ingredient: 'Cheddar Fatiado' } }])
        .pass,
    ).toBe(false);
  });
});

describe('gradeAnswer — more than one call', () => {
  it('accepts the expected calls in any order and rejects a missing or extra one', () => {
    const sales = { name: 'get_sales_summary', input: { period: 'today' } };
    const buy = { name: 'get_purchase_recommendation', input: {} };
    expect(gradeAnswer(byId('multi-1'), [buy, sales]).pass).toBe(true);
    expect(gradeAnswer(byId('multi-1'), [sales]).pass).toBe(false);
    // an extra read is let through (and counted); an extra write proposal is not
    const extra = gradeAnswer(byId('multi-1'), [sales, buy, { name: 'get_coverage', input: {} }]);
    expect(extra).toMatchObject({ pass: true, extras: 1 });
    const write = { name: 'propose_waste', input: { reason: 'expired', items: [] } };
    expect(gradeAnswer(byId('multi-1'), [sales, buy, write]).pass).toBe(false);
    expect(gradeAnswer(byId('multi-1'), [{ ...sales, input: { period: 'week' } }, buy]).pass).toBe(
      false,
    );
  });

  it('lets an extra read through but counts it, and still wants the right one', () => {
    const stock = { name: 'get_stock', input: { ingredient: 'Bacon' } };
    const coverage = { name: 'get_coverage', input: { ingredient: 'Bacon' } };
    expect(gradeAnswer(byId('stock-3'), [stock, coverage])).toMatchObject({
      pass: true,
      extras: 1,
    });
    expect(gradeAnswer(byId('stock-3'), [coverage, coverage]).pass).toBe(false);
  });

  it('accepts any of the listed alternatives for an argument', () => {
    const waste = (reason: string) => [
      {
        name: 'propose_waste',
        input: { reason, items: [{ ingredient: 'Fumaça Líquida', quantity: 2000 }] },
      },
    ];
    expect(gradeAnswer(byId('audio-5'), waste('other')).pass).toBe(true);
    expect(gradeAnswer(byId('audio-5'), waste('expired')).pass).toBe(true);
    expect(gradeAnswer(byId('audio-5'), waste('breakage')).pass).toBe(false);
  });
});

describe('numbersIn', () => {
  it('reads Brazilian numbers', () => {
    expect(numbersIn('R$ 1.543,85 em 28 pedidos, margem de 70,6%, 1.500 g')).toEqual([
      1543.85, 28, 70.6, 1500,
    ]);
    expect(numbersIn('custou 11,00.')).toEqual([11]);
  });
});

describe('gradeReply', () => {
  const reply = (id: string) => REPLY_CASES.find((c) => c.id === id)!;

  it('passes a reply that shows the returned numbers and invents none', () => {
    expect(
      gradeReply(
        reply('reply-2'),
        'Ontem foram 15 pedidos, R$ 820,06 de faturamento (ticket R$ 54,67).',
      ).pass,
    ).toBe(true);
  });

  it('fails a reply that leaves a key number out or makes one up', () => {
    expect(gradeReply(reply('reply-2'), 'Ontem foram 15 pedidos.').pass).toBe(false);
    const invented = gradeReply(reply('reply-1'), 'Tem 34 unidades, o que dura cerca de 12 dias.');
    expect(invented.pass).toBe(false);
  });

  it('does not call a number inside a name ("Angus 150 g") invented', () => {
    expect(
      gradeReply(reply('reply-1'), 'Temos 34 unidades de Angus 150 g, acima do mínimo de 20.').pass,
    ).toBe(true);
  });

  it('allows a rounded percentage and small list numbers', () => {
    expect(
      gradeReply(reply('reply-4'), '1) Preço R$ 28,90, custo R$ 9,20, margem de 68%.').pass,
    ).toBe(true);
  });

  it('wants incomplete data flagged, and a proposal never called saved', () => {
    expect(gradeReply(reply('reply-5'), 'O Davi custa R$ 7,50.').pass).toBe(false);
    expect(
      gradeReply(
        reply('reply-5'),
        'O custo é R$ 7,50, mas é só um piso: falta a ficha da calabresa.',
      ).pass,
    ).toBe(true);
    expect(
      gradeReply(reply('reply-7'), 'Pronto, registrei: Marcos, 2 kg de batata, R$ 37,54.').pass,
    ).toBe(false);
    expect(
      gradeReply(
        reply('reply-7'),
        'Entendi: Marcos levou 2 kg de batata (R$ 37,54). Confirma? Responda SIM.',
      ).pass,
    ).toBe(true);
  });
});

describe('the test bench itself', () => {
  it('has unique case ids and only expects functions that exist, with catalog names', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    const tools = new Set(TOOLS.map((t) => t.name));
    const names = new Set([...INGREDIENTS.map((i) => i.name), ...PRODUCTS]);
    for (const c of CASES) {
      if ('noTool' in c.expect) continue;
      const wanted = 'tools' in c.expect ? c.expect.tools : [c.expect];
      for (const want of wanted) {
        expect(tools.has(want.tool)).toBe(true);
        for (const key of ['ingredient', 'product', 'preparation']) {
          const value = want.args?.[key];
          if (typeof value === 'string') expect(names.has(value)).toBe(true);
        }
      }
    }
  });
});
