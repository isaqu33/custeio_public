/**
 * @jest-environment node
 */
import { type AttentionInputs, buildAttentionItems } from '@/app/lib/attention';

const none: AttentionInputs = {
  missingRecipes: { count: 0, revenue: 0, examples: [] },
  negativeStock: { count: 0, value: 0, examples: [] },
  emptyPreparations: { count: 0, examples: [] },
  noCost: { count: 0, examples: [] },
  priceUp: { count: 0, value: 0, examples: [] },
  lowStock: { count: 0, examples: [] },
  drafts: { count: 0 },
};

describe('buildAttentionItems', () => {
  it('is empty when nothing needs attention: all good', () => {
    expect(buildAttentionItems(none)).toEqual([]);
  });

  it('keeps only what has something to report, in the order that breaks the numbers most', () => {
    const items = buildAttentionItems({
      ...none,
      drafts: { count: 4 },
      priceUp: { count: 2, value: 31.456, examples: ['Maionese +9%'] },
      missingRecipes: { count: 2, revenue: 120.555, examples: ['Coca 220', 'Davi'] },
    });

    expect(items.map((item) => item.kind)).toEqual(['missing_recipes', 'price_up', 'drafts']);
    expect(items[0]).toMatchObject({ count: 2, value: 120.56 });
    expect(items[1]).toMatchObject({ count: 2, value: 31.46 });
    // money only where it can be said
    expect(items[2]?.value).toBeUndefined();
  });

  it('shows at most three examples per item', () => {
    const items = buildAttentionItems({
      ...none,
      negativeStock: { count: 9, value: 80, examples: ['a', 'b', 'c', 'd', 'e'] },
    });
    expect(items[0]?.examples).toEqual(['a', 'b', 'c']);
    expect(items[0]?.count).toBe(9);
  });
});
