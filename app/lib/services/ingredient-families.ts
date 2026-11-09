import Anthropic from '@anthropic-ai/sdk';
import connectDB from '@/app/lib/connect-db';
import { env } from '@/app/lib/env';
import { isInOperation } from '@/app/lib/ingredient-naming';
import { logger } from '@/app/lib/logger';
import { significantTokens } from '@/app/lib/menu-evidence';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import RawIngredientDB from '@/app/models/raw-ingredients';

// The AI GROUPS ingredients into families ("Bacon" > "Bacon Sadia 1kg", "Bacon Meia Manta") so the list
// shows one line per base ingredient. Unlike a merge it only sets `familyOf`: nothing is added up or
// deleted, and the owner undoes it in the ingredient's form. It looks at an ingredient once
// (`familyAiCheckedAt`), so what the owner changed afterwards is never redone.

export const FAMILIES_MODEL = 'claude-haiku-5-5';
const PRICE_PER_MILLION = { input: 0.1, output: 0.5 };
const MAX_CLUSTER = 24;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['main', 'variants', 'confidence', 'reason'],
        properties: {
          main: {
            type: 'string',
            description: 'Nome EXATO do item mais genérico da lista, que representa o insumo base.',
          },
          variants: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Nomes EXATOS dos itens que são variações (marca, embalagem, corte) de main.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string', description: 'Uma frase.' },
        },
      },
    },
  },
} as const;

const SYSTEM = `Você ajuda uma hamburgueria brasileira a organizar o cadastro de insumos, que vem de notas fiscais com nomes abreviados, de marcas, embalagens e cortes diferentes.

Dada uma lista de itens, agrupe em FAMÍLIAS: um item principal, o mais genérico da lista (ex.: "Bacon"), e as variações dele, que são o mesmo insumo base em outra marca, embalagem ou corte (ex.: "Bacon Sadia Pd 1kg", "Bacon Meia Manta Pd"). A cozinha chama todos pelo nome do principal.

Só agrupe se o principal estiver NA LISTA e tiver nome genérico: sem marca, sem tamanho e sem embalagem (ex.: "Bacon", "Tomate", "Cebola"). Um item com marca ou tamanho no nome ("Molho Barbecue Cepera 3,5kg") não serve de principal. Se nenhum item tiver nome genérico, não agrupe. NÃO agrupe produtos de tipo diferente que só dividem uma palavra (ex.: "Batata Palha" ou "Batata Congelada" não são variação de "Batata Inglesa"; "Cebola Caramelizada" é um preparo), nem itens de uso diferente. Na dúvida, não agrupe. Itens sem família ficam de fora. Use os nomes EXATOS da lista.`;

export type FamilyRow = {
  _id: unknown;
  name: string;
  unit: string;
  kind?: string;
  inOperation?: boolean;
  isPreparation?: boolean;
  preparation?: unknown;
  familyOf?: unknown;
  familyAiCheckedAt?: Date;
  hasVariants?: boolean;
};

export type FamilyProposal = {
  main: string;
  variants: string[];
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
};

/**
 * One cluster per first significant word of the name ("Bacon ..." together), small enough to show the
 * AI, and only those with something new in them: at least two items, one never looked at.
 */
export function familyClusters(rows: FamilyRow[]): FamilyRow[][] {
  const byWord = new Map<string, FamilyRow[]>();
  for (const row of rows) {
    const [first] = significantTokens(row.name);
    if (first) byWord.set(first, [...(byWord.get(first) ?? []), row]);
  }
  return [...byWord.values()].filter(
    (members) =>
      members.length >= 2 &&
      members.length <= MAX_CLUSTER &&
      members.some((member) => !member.familyAiCheckedAt),
  );
}

/**
 * What the code accepts of the AI's answer: confident groups, built only from the offered names, whose
 * main is not itself a variation, and whose variants are unchecked, have no variations of their own and
 * are not the main. The same rules the server enforces when the owner groups by hand.
 */
export function acceptFamilyProposals(
  cluster: FamilyRow[],
  proposals: FamilyProposal[],
): Array<{ variantId: string; mainId: string }> {
  const byName = new Map(cluster.map((row) => [row.name, row]));
  const variantIds = new Set<string>();
  const mainIds = new Set<string>();
  const accepted: Array<{ variantId: string; mainId: string }> = [];
  const canBeVariant = (variant: FamilyRow | undefined, main: FamilyRow): variant is FamilyRow =>
    Boolean(variant) &&
    variant !== main &&
    !variant?.hasVariants &&
    !variant?.familyAiCheckedAt &&
    !variantIds.has(String(variant?._id)) &&
    !mainIds.has(String(variant?._id));
  for (const proposal of proposals) {
    const main = byName.get(proposal.main);
    // A main with a size in its name ("... 200ml") is one product among others, not the base ingredient.
    if (!main || main.familyOf || proposal.confidence === 'low' || /\d/.test(main.name)) continue;
    if (variantIds.has(String(main._id))) continue;
    for (const variant of proposal.variants.map((name) => byName.get(name))) {
      if (!canBeVariant(variant, main)) continue;
      variantIds.add(String(variant._id));
      mainIds.add(String(main._id));
      accepted.push({ variantId: String(variant._id), mainId: String(main._id) });
    }
  }
  return accepted;
}

export type FamilyCall = (_cluster: FamilyRow[]) => Promise<{
  proposals: FamilyProposal[];
  inputTokens: number;
  outputTokens: number;
}>;

export function createAnthropicFamilyCall(): FamilyCall {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return async (cluster) => {
    const list = cluster.map((r) => `- "${r.name}" (${r.unit})`).join('\n');
    const response = await client.messages.create({
      model: FAMILIES_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `Itens:\n${list}` }],
    });
    const text =
      response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ??
      '{"groups":[]}';
    return {
      proposals: (JSON.parse(text) as { groups: FamilyProposal[] }).groups,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}

export type FamilySummary = {
  clusters: number;
  grouped: number;
  spentUsd: number;
  stoppedByBudget: boolean;
};

/** Groups the store's ingredients into families, once per ingredient. Costs cents; stops past `maxUsd`. */
export async function groupIngredientFamilies(params: {
  storeId: string;
  call?: FamilyCall;
  maxUsd?: number;
}): Promise<FamilySummary> {
  await connectDB();
  const store = toObjectId(params.storeId);
  const call = params.call ?? createAnthropicFamilyCall();
  const maxUsd = params.maxUsd ?? 0.3;

  const [all, withVariants] = await Promise.all([
    RawIngredientDB.find({ storeId: store })
      .select('name unit kind inOperation isPreparation preparation familyOf familyAiCheckedAt')
      .lean<FamilyRow[]>(),
    RawIngredientDB.distinct('familyOf', { storeId: store, familyOf: { $exists: true } }),
  ]);
  const mainsWithVariants = new Set(withVariants.map(String));
  // A preparation is made, not bought; one already a variation is placed. Neither is grouped here.
  const rows = all
    .filter(
      (row) =>
        isInOperation(row) &&
        !row.familyOf &&
        !row.isPreparation &&
        !(row.preparation as { lines?: unknown[] } | undefined)?.lines?.length,
    )
    .map((row) => ({ ...row, hasVariants: mainsWithVariants.has(String(row._id)) }));

  const clusters = familyClusters(rows);
  let spentUsd = 0;
  let grouped = 0;
  let stoppedByBudget = false;
  for (const cluster of clusters) {
    if (spentUsd > maxUsd) {
      stoppedByBudget = true;
      break;
    }
    try {
      const result = await call(cluster);
      spentUsd +=
        (result.inputTokens * PRICE_PER_MILLION.input +
          result.outputTokens * PRICE_PER_MILLION.output) /
        1_000_000;
      grouped += await applyFamilies(
        store,
        cluster,
        acceptFamilyProposals(cluster, result.proposals),
      );
    } catch (err) {
      logger.warn(
        { err, cluster: cluster.map((c) => c.name) },
        'family grouping failed for a cluster',
      );
    }
  }
  return { clusters: clusters.length, grouped, spentUsd, stoppedByBudget };
}

async function applyFamilies(
  store: ReturnType<typeof toObjectId>,
  cluster: FamilyRow[],
  accepted: Array<{ variantId: string; mainId: string }>,
): Promise<number> {
  let grouped = 0;
  for (const { variantId, mainId } of accepted) {
    // Never over a family someone set in the meantime.
    const result = await RawIngredientDB.updateOne(
      { _id: toObjectId(variantId), storeId: store, familyOf: { $exists: false } },
      { $set: { familyOf: toObjectId(mainId) } },
    );
    grouped += result.modifiedCount;
  }
  await RawIngredientDB.updateMany(
    { _id: { $in: toObjectIds(cluster.map((row) => String(row._id))) }, storeId: store },
    { $set: { familyAiCheckedAt: new Date() } },
  );
  return grouped;
}
