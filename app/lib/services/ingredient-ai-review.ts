import Anthropic from '@anthropic-ai/sdk';
import connectDB from '@/app/lib/connect-db';
import { env } from '@/app/lib/env';
import { OPERATIONAL_KINDS } from '@/app/lib/ingredient-naming';
import { logger } from '@/app/lib/logger';
import { type MenuEntry, menuEvidenceFor, similarNames } from '@/app/lib/menu-evidence';
import { toObjectId } from '@/app/lib/mongo-id';
import PartnerProductDB from '@/app/models/partner-products';
import ProductRecipeDB from '@/app/models/product-recipes';
import RawIngredientDB from '@/app/models/raw-ingredients';

// The AI PROPOSES: it writes `aiReview`, and (when confident) the `inOperation` call the owner can
// override in the edit form. Renaming, re-typing and merging stay with the owner.

export const REVIEW_MODEL = 'claude-haiku-5-5';
const PRICE_PER_MILLION = { input: 0.1, output: 0.5 };

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'usedByRestaurant',
    'kind',
    'cleanName',
    'aliases',
    'pack',
    'mergeInto',
    'confidence',
    'note',
  ],
  properties: {
    usedByRestaurant: {
      type: 'boolean',
      description:
        'É insumo, embalagem ou material da operação de uma hamburgueria (cozinha, salão, entrega)?',
    },
    kind: { type: 'string', enum: ['food', 'packaging', 'cleaning', 'other'] },
    cleanName: { type: 'string', description: 'Nome legível, sem abreviações de nota fiscal.' },
    aliases: {
      type: 'array',
      items: { type: 'string' },
      description: 'Como a equipe chamaria. Máx. 3.',
    },
    pack: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['quantity', 'unit'],
      properties: {
        quantity: { type: 'number' },
        unit: { type: 'string', enum: ['g', 'ml', 'un'] },
      },
      description:
        'Quanto vem em UMA unidade comprada, lido do nome (400g = 400 g; 2,27kg = 2270 g; 750ml = 750 ml). null se o nome não diz.',
    },
    mergeInto: {
      type: ['string', 'null'],
      description:
        'Nome EXATO de um insumo da lista de parecidos que seja o mesmo produto; senão null.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string', description: 'Uma frase curta com o motivo.' },
  },
} as const;

export type ReviewProposal = {
  usedByRestaurant: boolean;
  kind: 'food' | 'packaging' | 'cleaning' | 'other';
  cleanName: string;
  aliases: string[];
  pack: { quantity: number; unit: 'g' | 'ml' | 'un' } | null;
  mergeInto: string | null;
  confidence: 'high' | 'medium' | 'low';
  note: string;
};

export type ReviewItem = {
  name: string;
  unit: string;
  kind: string;
  supplierName?: string;
  /** The few menu lines that look like it — never the whole menu. */
  menu: MenuEntry[];
  /** Already reviewed ingredients with a similar name, the only valid targets of `mergeInto`. */
  similar: string[];
};

export type ReviewCall = (_item: ReviewItem) => Promise<{
  proposal: ReviewProposal;
  inputTokens: number;
  outputTokens: number;
}>;

const SYSTEM = `Você revisa o cadastro de insumos de uma hamburgueria brasileira. Os itens vêm de notas fiscais de supermercado e atacado: os nomes são abreviados (ex.: "Far Milho Bonoflokos Flocao Pc 400g") e a loja também compra coisas que NÃO são da operação (uso pessoal, mercado).

Para cada item você recebe linhas do cardápio da loja que se parecem com ele. Uma linha parecida é um forte sinal de que o item é usado. Nenhuma linha NÃO prova que não é da operação (embalagens e descartáveis não aparecem no cardápio), mas para um alimento sem nenhuma linha no cardápio seja conservador.
Seja conservador: se não houver motivo claro para ser da hamburgueria, marque usedByRestaurant como false e confiança baixa.`;

export function describeItem(item: ReviewItem): string {
  const menu = item.menu.length
    ? item.menu
        .map((entry) => `${entry.type === 'product' ? 'produto' : 'complemento'} "${entry.label}"`)
        .join('; ')
    : 'nenhuma linha do cardápio parece usar este item';
  const similar = item.similar.length
    ? item.similar.map((name) => `"${name}"`).join('; ')
    : 'nenhum';
  return `Item: "${item.name}" (cadastrado em ${item.unit}; fornecedor: ${item.supplierName ?? '—'}; tipo atual: ${item.kind})
Cardápio: ${menu}
Insumos já revisados com nome parecido (para mergeInto): ${similar}`;
}

/** The real call: one small request per ingredient, structured output. */
export function createAnthropicReviewCall(): ReviewCall {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return async (item) => {
    const response = await client.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{ role: 'user', content: describeItem(item) }],
    });
    const text =
      response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ??
      '{}';
    return {
      proposal: JSON.parse(text) as ReviewProposal,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}

export type ReviewSummary = {
  analyzed: number;
  skippedInRecipe: number;
  failed: number;
  inOperation: number;
  outOfOperation: number;
  spentUsd: number;
  stoppedByBudget: boolean;
};

type DraftRow = {
  _id: unknown;
  name: string;
  unit: string;
  kind?: string;
  lastPurchase?: { supplierName?: string };
};

type LineRef = { rawIngredientId: unknown };
type ProductRow = {
  name: string;
  recipe?: LineRef[];
  modifiers?: Array<{ name: string; recipe?: LineRef[] }>;
};

type ReviewContext = {
  drafts: DraftRow[];
  reviewedNames: string[];
  menu: MenuEntry[];
  usedInRecipe: Set<string>;
};

/** Everything the review needs to know about the store, read once. */
async function loadContext(storeId: string, force?: boolean): Promise<ReviewContext> {
  const store = toObjectId(storeId);
  const [reviewed, drafts, products, productRecipes, preparations] = await Promise.all([
    RawIngredientDB.find({ storeId: store, isDraft: { $ne: true } })
      .select('name')
      .lean<Array<{ name: string }>>(),
    RawIngredientDB.find({
      storeId: store,
      isDraft: true,
      ...(force ? {} : { aiReview: { $exists: false } }),
    })
      .select('name unit kind lastPurchase.supplierName')
      .sort({ name: 1 })
      .lean<DraftRow[]>(),
    PartnerProductDB.find({ storeId: store })
      .select('name modifiers.name recipe.rawIngredientId modifiers.recipe.rawIngredientId')
      .lean<ProductRow[]>(),
    ProductRecipeDB.find({ storeId: store })
      .select('recipe.rawIngredientId')
      .lean<Array<{ recipe?: LineRef[] }>>(),
    RawIngredientDB.find({ storeId: store, 'preparation.lines.0': { $exists: true } })
      .select('preparation.lines.rawIngredientId')
      .lean<Array<{ preparation?: { lines?: LineRef[] } }>>(),
  ]);

  const usedInRecipe = new Set<string>();
  const addLines = (lines?: LineRef[]) =>
    lines?.forEach((line) => usedInRecipe.add(String(line.rawIngredientId)));
  const menu: MenuEntry[] = [];
  for (const product of products) {
    menu.push({ label: product.name, type: 'product' });
    addLines(product.recipe);
    for (const modifier of product.modifiers ?? []) {
      menu.push({ label: modifier.name, type: 'modifier' });
      addLines(modifier.recipe);
    }
  }
  productRecipes.forEach((doc) => addLines(doc.recipe));
  preparations.forEach((doc) => addLines(doc.preparation?.lines));
  return { drafts, reviewedNames: reviewed.map((row) => row.name), menu, usedInRecipe };
}

/** Saves one proposal; the confident "part of the operation" call also takes effect unless decided. */
async function saveProposal(id: unknown, item: ReviewItem, proposal: ReviewProposal) {
  // mergeInto must be a name we offered, never an invention.
  const mergeInto =
    proposal.mergeInto && item.similar.includes(proposal.mergeInto) ? proposal.mergeInto : null;
  await RawIngredientDB.updateOne(
    { _id: id },
    {
      $set: {
        aiReview: {
          analyzedAt: new Date(),
          model: REVIEW_MODEL,
          usedByRestaurant: proposal.usedByRestaurant,
          kind: proposal.kind,
          cleanName: proposal.cleanName,
          aliases: (proposal.aliases ?? []).slice(0, 3),
          ...(proposal.pack && { pack: proposal.pack }),
          ...(mergeInto && { mergeInto }),
          confidence: proposal.confidence,
          note: proposal.note,
          comparedWithMenu: true,
        },
      },
    },
  );
  // The owner overrides this in the edit form; name, kind and merges stay proposals. A cleaning or
  // "other" item the AI finds useful keeps following its kind (stock alerts are for food/packaging).
  const decides = !proposal.usedByRestaurant || OPERATIONAL_KINDS.includes(proposal.kind);
  if (proposal.confidence !== 'low' && decides) {
    await RawIngredientDB.updateOne(
      { _id: id, inOperation: { $exists: false } },
      { $set: { inOperation: proposal.usedByRestaurant } },
    );
  }
}

/**
 * Proposes, for every unreviewed ingredient of the store that has no AI review yet (or all of them,
 * with `force`), what it is and whether the store really uses it. Resumable: a second run only does
 * what is left. Ingredients that already sit in a recipe are in the operation by fact and cost nothing.
 */
export async function reviewDraftIngredients(params: {
  storeId: string;
  force?: boolean;
  maxUsd?: number;
  call?: ReviewCall;
  onProgress?: (_done: number, _total: number) => Promise<void> | void;
}): Promise<ReviewSummary> {
  await connectDB();
  const maxUsd = params.maxUsd ?? 1;
  const call = params.call ?? createAnthropicReviewCall();
  const { drafts, reviewedNames, menu, usedInRecipe } = await loadContext(
    params.storeId,
    params.force,
  );
  const summary: ReviewSummary = {
    analyzed: 0,
    skippedInRecipe: 0,
    failed: 0,
    inOperation: 0,
    outOfOperation: 0,
    spentUsd: 0,
    stoppedByBudget: false,
  };
  const todo = drafts.filter((draft) => !usedInRecipe.has(String(draft._id)));
  summary.skippedInRecipe = drafts.length - todo.length;

  for (const [index, draft] of todo.entries()) {
    if (summary.spentUsd > maxUsd) {
      summary.stoppedByBudget = true;
      break;
    }
    const item: ReviewItem = {
      name: draft.name,
      unit: draft.unit,
      kind: draft.kind ?? 'food',
      supplierName: draft.lastPurchase?.supplierName,
      menu: menuEvidenceFor(draft.name, menu),
      similar: similarNames(draft.name, reviewedNames),
    };
    try {
      const { proposal, inputTokens, outputTokens } = await call(item);
      summary.spentUsd +=
        (inputTokens * PRICE_PER_MILLION.input + outputTokens * PRICE_PER_MILLION.output) /
        1_000_000;
      await saveProposal(draft._id, item, proposal);
      summary.analyzed += 1;
      summary[proposal.usedByRestaurant ? 'inOperation' : 'outOfOperation'] += 1;
    } catch (err) {
      summary.failed += 1;
      logger.warn({ err, ingredient: draft.name }, 'ingredient AI review failed for one item');
    }
    await params.onProgress?.(index + 1, todo.length);
  }
  return summary;
}
