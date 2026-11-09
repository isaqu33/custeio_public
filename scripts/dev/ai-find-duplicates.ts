/**
 * READ-ONLY preview of what the "duplicados" analysis would suggest for a store (the same code the
 * `ai.ingredients.review` job runs, minus saving). Costs real money (cents): stops past --max-usd.
 *
 * Usage: npx tsx scripts/dev/ai-find-duplicates.ts --store <storeId> [--max-usd 0.3]
 */
import '../load-env';
import mongoose from 'mongoose';
import { consolidateDuplicateGroups, type DuplicateProposal } from '../../app/lib/duplicate-groups';
import { isInOperation } from '../../app/lib/ingredient-naming';
import { toObjectId } from '../../app/lib/mongo-id';
import {
  clusterCandidates,
  createAnthropicDuplicateCall,
  type DuplicateRow,
} from '../../app/lib/services/ingredient-duplicates';
import RawIngredientDB from '../../app/models/raw-ingredients';

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store is required');
  const maxUsd = Number(arg('max-usd') ?? 0.3);
  await mongoose.connect(process.env.DATABASE_URL as string);
  const rows = (
    await RawIngredientDB.find({ storeId: toObjectId(storeId) })
      .select('name unit currentStock averageCost kind inOperation preparation aliases')
      .lean<DuplicateRow[]>()
  ).filter((row) => isInOperation(row));
  await mongoose.disconnect();

  const call = createAnthropicDuplicateCall();
  const clusters = clusterCandidates(rows);
  const proposals: DuplicateProposal[] = [];
  let spent = 0;
  for (const cluster of clusters) {
    if (spent > maxUsd) break;
    const result = await call(cluster);
    spent += (result.inputTokens * 0.1 + result.outputTokens * 0.5) / 1_000_000;
    proposals.push(...result.proposals);
  }
  const unitOf = (n: string) => rows.find((r) => r.name === n)?.unit;
  const groups = consolidateDuplicateGroups(proposals, unitOf);
  for (const [title, list] of [
    ['PRONTOS PARA JUNTAR', groups.filter((g) => !g.convertFirst)],
    ['CONVERTER ANTES DE JUNTAR', groups.filter((g) => g.convertFirst)],
  ] as const) {
    console.log(`=== ${title} (${list.length}) ===`);
    for (const g of list) {
      console.log(`● manter: ${g.keep} [${unitOf(g.keep)}]  (${g.confidence})`);
      g.merge.forEach((n) => console.log(`    ← ${n} [${unitOf(n)}]`));
      console.log(`    ${g.reason}${g.convertFirst ? `\n    ⚠ ${g.convertFirst}` : ''}`);
    }
  }
  console.log(`\n${groups.length} grupo(s) · custo US$ ${spent.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
