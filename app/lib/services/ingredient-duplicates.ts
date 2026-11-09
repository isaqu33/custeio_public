import Anthropic from '@anthropic-ai/sdk';
import connectDB from '@/app/lib/connect-db';
import {
  consolidateDuplicateGroups,
  type DuplicateGroup,
  type DuplicateProposal,
} from '@/app/lib/duplicate-groups';
import { env } from '@/app/lib/env';
import { isInOperation } from '@/app/lib/ingredient-naming';
import { logger } from '@/app/lib/logger';
import { significantTokens } from '@/app/lib/menu-evidence';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { mergedTotals, mergeRawIngredients } from '@/app/lib/services/ingredient-merge';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import IngredientMergeSuggestionDB from '@/app/models/ingredient-merge-suggestions';
import RawIngredientDB from '@/app/models/raw-ingredients';

// The AI PROPOSES which ingredients are the same thing; nothing is merged here. The owner merges one
// suggestion at a time through the same "Juntar insumos" service, or dismisses it.

export const DUPLICATES_MODEL = 'claude-haiku-5-5';
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
        required: ['keep', 'merge', 'shouldMerge', 'confidence', 'reason'],
        properties: {
          keep: {
            type: 'string',
            description: 'Nome EXATO do insumo que fica (o mais genérico/usado).',
          },
          merge: {
            type: 'array',
            items: { type: 'string' },
            description: 'Nomes EXATOS dos que devem ser juntados em "keep". Nunca inclua o keep.',
          },
          shouldMerge: {
            type: 'boolean',
            description:
              'true só se são realmente o mesmo insumo; false se você concluiu que NÃO devem ser juntados.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string', description: 'Uma frase.' },
        },
      },
    },
  },
} as const;

const SYSTEM = `Você ajuda uma hamburgueria brasileira a limpar o cadastro de insumos. Os itens vêm de notas fiscais e têm nomes abreviados, de marcas, embalagens e fornecedores diferentes.

Dada uma lista de itens, indique os que são O MESMO insumo e deveriam ser juntados: algo que a cozinha usaria de forma intercambiável numa receita (ex.: "Mostarda Cepera Bombona" e "Mostarda Heinz 200g"; "Tomate kg" e "Tomate Italiano"). Marca, tamanho da embalagem e fornecedor diferentes NÃO impedem juntar.

NÃO junte: produtos de tipo diferente (ketchup a granel x sachê individual, normal x zero açúcar, sabores diferentes, preparo x matéria-prima, bebida de tamanhos que o cardápio vende separado), nem itens só parecidos no nome. Na dúvida, não junte. Só liste um grupo se concluir que deve ser juntado (shouldMerge true); se concluir que NÃO, não o liste. Itens sem par ficam de fora. Use os nomes EXATOS da lista.`;

export type DuplicateRow = {
  _id: unknown;
  name: string;
  unit: string;
  currentStock?: number;
  averageCost?: number;
  kind?: string;
  inOperation?: boolean;
  isPreparation?: boolean;
  isDraft?: boolean;
  preparation?: unknown;
  aliases?: string[];
};

/** One small cluster per word: the names containing it. The same set reached by two words is one. */
export function clusterCandidates(rows: DuplicateRow[]): DuplicateRow[][] {
  const byWord = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    for (const token of significantTokens(`${row.name} ${(row.aliases ?? []).join(' ')}`)) {
      byWord.set(token, [...(byWord.get(token) ?? []), row]);
    }
  }
  const seen = new Set<string>();
  const clusters: DuplicateRow[][] = [];
  for (const members of byWord.values()) {
    if (members.length < 2 || members.length > MAX_CLUSTER) continue;
    const key = members
      .map((m) => String(m._id))
      .sort()
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push(members);
  }
  return clusters;
}

export type DuplicateCall = (_cluster: DuplicateRow[]) => Promise<{
  proposals: DuplicateProposal[];
  inputTokens: number;
  outputTokens: number;
}>;

export function createAnthropicDuplicateCall(): DuplicateCall {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return async (cluster) => {
    const list = cluster
      .map(
        (r) =>
          `- "${r.name}" (${r.unit}; saldo ${Math.round(r.currentStock ?? 0)}; custo ${(r.averageCost ?? 0).toFixed(4)}/${r.unit}${r.preparation ? '; é um preparo' : ''})`,
      )
      .join('\n');
    const response = await client.messages.create({
      model: DUPLICATES_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `Itens:\n${list}` }],
    });
    const text =
      response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ??
      '{"groups":[]}';
    const names = new Set(cluster.map((r) => r.name));
    // Only names we offered, never an invention.
    const proposals = (JSON.parse(text) as { groups: DuplicateProposal[] }).groups
      .map((g) => ({ ...g, merge: g.merge.filter((n) => names.has(n) && n !== g.keep) }))
      .filter((g) => names.has(g.keep) && g.merge.length > 0);
    return {
      proposals,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}

/**
 * Merged without asking: the owner never confirmed the new ones (drafts from a note) and the AI is sure
 * they are the same product as one he already settled. Merging cannot be undone, so nothing else
 * qualifies: high confidence, same unit, no conversion needed, exactly one settled ingredient (the one
 * kept) and every other one still a draft.
 */
export function isSafeAutoMerge(group: DuplicateGroup, byName: Map<string, DuplicateRow>): boolean {
  if (group.confidence !== 'high' || group.convertFirst) return false;
  const keep = byName.get(group.keep);
  const others = group.merge.map((name) => byName.get(name));
  if (!keep || keep.isDraft || others.some((row) => !row || !row.isDraft)) return false;
  return others.every((row) => row?.unit === keep.unit);
}

export type AutoMerged = { kept: string; merged: string[] };

export type DuplicateSearchSummary = {
  clusters: number;
  suggestions: number;
  autoMerged: AutoMerged[];
  spentUsd: number;
  stoppedByBudget: boolean;
};

/**
 * Asks the AI which of the store's in-operation ingredients are duplicates and stores the result as
 * pending suggestions (replacing the pending ones of an earlier run; dismissed ones are remembered and
 * not suggested again).
 */
export async function findDuplicateSuggestions(params: {
  storeId: string;
  call?: DuplicateCall;
  maxUsd?: number;
  /** Merge the safe groups (see `isSafeAutoMerge`) instead of suggesting them. */
  autoMerge?: boolean;
}): Promise<DuplicateSearchSummary> {
  await connectDB();
  const store = toObjectId(params.storeId);
  const call = params.call ?? createAnthropicDuplicateCall();
  const maxUsd = params.maxUsd ?? 0.5;

  const all = await RawIngredientDB.find({ storeId: store })
    .select(
      'name unit currentStock averageCost kind inOperation isPreparation isDraft preparation aliases',
    )
    .lean<DuplicateRow[]>();
  // A preparation (it has a recipe) is made, not bought: it is never a duplicate of a purchase.
  const rows = all.filter(
    (row) =>
      isInOperation(row) &&
      !row.isPreparation &&
      !(row.preparation as { lines?: unknown[] } | undefined)?.lines?.length,
  );
  const byName = new Map(rows.map((row) => [row.name, row]));
  const clusters = clusterCandidates(rows);

  const proposals: DuplicateProposal[] = [];
  let spentUsd = 0;
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
      proposals.push(...result.proposals);
    } catch (err) {
      logger.warn(
        { err, cluster: cluster.map((c) => c.name) },
        'duplicate search failed for a cluster',
      );
    }
  }

  const candidateGroups = consolidateDuplicateGroups(proposals, (name) => byName.get(name)?.unit);
  const autoMerged: AutoMerged[] = [];
  const groups = params.autoMerge
    ? await withoutAutoMerged(params.storeId, candidateGroups, byName, autoMerged)
    : candidateGroups;
  const saved = await saveSuggestions(params.storeId, groups, byName);
  return { clusters: clusters.length, suggestions: saved, autoMerged, spentUsd, stoppedByBudget };
}

/** Merges the safe groups and returns the rest, which stay suggestions for the owner. */
async function withoutAutoMerged(
  storeId: string,
  groups: DuplicateGroup[],
  byName: Map<string, DuplicateRow>,
  autoMerged: AutoMerged[],
): Promise<DuplicateGroup[]> {
  const rest: DuplicateGroup[] = [];
  for (const group of groups) {
    const keep = byName.get(group.keep);
    if (!keep || !isSafeAutoMerge(group, byName)) {
      rest.push(group);
      continue;
    }
    try {
      await mergeRawIngredients({
        storeId,
        targetId: String(keep._id),
        sourceIds: group.merge.map((name) => String((byName.get(name) as DuplicateRow)._id)),
      });
      autoMerged.push({ kept: group.keep, merged: group.merge });
    } catch (err) {
      // E.g. a name clash in an order: the owner decides that one.
      logger.warn({ err, keep: group.keep }, 'automatic merge skipped');
      rest.push(group);
    }
  }
  return rest;
}

async function saveSuggestions(
  storeId: string,
  groups: DuplicateGroup[],
  byName: Map<string, DuplicateRow>,
): Promise<number> {
  const store = toObjectId(storeId);
  const dismissed = new Set(
    (
      await IngredientMergeSuggestionDB.find({ storeId: store, status: 'dismissed' })
        .select('signature')
        .lean<Array<{ signature: string }>>()
    ).map((doc) => doc.signature),
  );
  await IngredientMergeSuggestionDB.deleteMany({ storeId: store, status: 'pending' });
  let saved = 0;
  for (const group of groups) {
    const keep = byName.get(group.keep);
    const others = group.merge.map((name) => byName.get(name));
    if (!keep || others.some((o) => !o)) continue;
    const ids = [keep, ...(others as DuplicateRow[])].map((r) => String(r._id));
    const signature = [...ids].sort().join(',');
    if (dismissed.has(signature)) continue;
    await IngredientMergeSuggestionDB.create({
      storeId: store,
      keepId: toObjectId(ids[0] as string),
      mergeIds: toObjectIds(ids.slice(1)),
      signature,
      confidence: group.confidence,
      reason: group.reason,
      ...(group.convertFirst && { convertFirst: group.convertFirst }),
      model: DUPLICATES_MODEL,
    });
    saved += 1;
  }
  return saved;
}

export type DuplicateMember = {
  _id: string;
  name: string;
  unit: string;
  currentStock: number;
  averageCost: number;
};

export type DuplicateSuggestionItem = {
  _id: string;
  keep: DuplicateMember;
  merge: DuplicateMember[];
  confidence: 'high' | 'medium';
  reason: string;
  convertFirst?: string;
  /** What the kept ingredient would hold after the merge (the same arithmetic as the merge itself). */
  after?: { currentStock: number; averageCost: number };
};

const member = (doc: LeanDoc): DuplicateMember => ({
  _id: String(doc._id),
  name: String(doc.name),
  unit: String(doc.unit),
  currentStock: Number(doc.currentStock ?? 0),
  averageCost: Number(doc.averageCost ?? 0),
});

type SuggestionDoc = LeanDoc & { keepId: unknown; mergeIds: unknown[] };

/** One stored suggestion with its ingredients as they are now; null when one of them is gone. */
function toSuggestionItem(
  s: SuggestionDoc,
  byId: Map<string, LeanDoc>,
): DuplicateSuggestionItem | null {
  const keep = byId.get(String(s.keepId));
  const others = s.mergeIds.map((id) => byId.get(String(id)));
  if (!keep || others.some((o) => !o)) return null;
  const members = [keep, ...(others as LeanDoc[])];
  const convertFirst = s.convertFirst ? String(s.convertFirst) : undefined;
  const totals = convertFirst ? undefined : mergedTotals(members, keep, 'average');
  return {
    _id: String(s._id),
    keep: member(keep),
    merge: (others as LeanDoc[]).map(member),
    confidence: s.confidence as 'high' | 'medium',
    reason: String(s.reason ?? ''),
    ...(convertFirst && { convertFirst }),
    ...(totals && {
      after: { currentStock: totals.currentStock, averageCost: totals.averageCost },
    }),
  };
}

/**
 * The pending suggestions of the store with their ingredients as they are now. One whose ingredients
 * were merged or deleted since is dropped here (and removed), so merging needs no bookkeeping.
 */
export async function listDuplicateSuggestions(
  storeId: string,
): Promise<DuplicateSuggestionItem[]> {
  await connectDB();
  const store = toObjectId(storeId);
  const suggestions = await IngredientMergeSuggestionDB.find({ storeId: store, status: 'pending' })
    .sort({ confidence: 1, createdAt: -1 })
    .lean<SuggestionDoc[]>();
  if (suggestions.length === 0) return [];
  const ids = [
    ...new Set(suggestions.flatMap((s) => [String(s.keepId), ...s.mergeIds.map(String)])),
  ];
  const docs = await RawIngredientDB.find({ _id: { $in: toObjectIds(ids) }, storeId: store })
    .select('name unit currentStock averageCost minAlertStock costBasis lastPurchase')
    .lean<LeanDoc[]>();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const items: DuplicateSuggestionItem[] = [];
  const stale: unknown[] = [];
  for (const s of suggestions) {
    const item = toSuggestionItem(s, byId);
    if (item) items.push(item);
    else stale.push(s._id);
  }
  if (stale.length) await IngredientMergeSuggestionDB.deleteMany({ _id: { $in: stale } });
  // Ready to merge first.
  return items.sort((a, b) => Number(Boolean(a.convertFirst)) - Number(Boolean(b.convertFirst)));
}

/** "Ignorar": remembered, so the next analysis does not suggest the same group again. */
export async function dismissDuplicateSuggestion(id: string): Promise<void> {
  await connectDB();
  await IngredientMergeSuggestionDB.updateOne(
    { _id: toObjectId(id) },
    { $set: { status: 'dismissed' } },
  );
}

/** The store a suggestion belongs to — routes authorize through it before trusting the id. */
export async function getSuggestionStoreId(id: string): Promise<string | null> {
  await connectDB();
  const doc = await IngredientMergeSuggestionDB.findById(toObjectId(id)).select('storeId').lean();
  return doc ? String((doc as LeanDoc).storeId) : null;
}
