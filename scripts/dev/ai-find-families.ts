/**
 * READ-ONLY preview of the families the AI would group (the same code the `ai.ingredients.review` job
 * runs, minus writing `familyOf`). Costs real money (cents): stops past --max-usd.
 *
 * Usage: npx tsx scripts/dev/ai-find-families.ts --store <storeId> [--max-usd 0.3]
 */
import '../load-env';
import mongoose from 'mongoose';
import { isInOperation } from '../../app/lib/ingredient-naming';
import { toObjectId } from '../../app/lib/mongo-id';
import {
  acceptFamilyProposals,
  createAnthropicFamilyCall,
  familyClusters,
  type FamilyRow,
} from '../../app/lib/services/ingredient-families';
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
      .select('name unit kind inOperation isPreparation preparation familyOf familyAiCheckedAt')
      .lean<FamilyRow[]>()
  ).filter(
    (row) =>
      isInOperation(row) &&
      !row.familyOf &&
      !row.isPreparation &&
      !(row.preparation as { lines?: unknown[] } | undefined)?.lines?.length,
  );
  await mongoose.disconnect();

  const call = createAnthropicFamilyCall();
  const clusters = familyClusters(rows);
  let spent = 0;
  let total = 0;
  for (const cluster of clusters) {
    if (spent > maxUsd) break;
    const result = await call(cluster);
    spent += (result.inputTokens * 0.1 + result.outputTokens * 0.5) / 1_000_000;
    const byId = new Map(cluster.map((r) => [String(r._id), r.name]));
    const accepted = acceptFamilyProposals(cluster, result.proposals);
    const mains = new Set(accepted.map((a) => a.mainId));
    for (const mainId of mains) {
      console.log(`● ${byId.get(mainId)}`);
      for (const a of accepted.filter((x) => x.mainId === mainId)) {
        console.log(`    ← ${byId.get(a.variantId)}`);
        total += 1;
      }
    }
  }
  console.log(
    `\n${clusters.length} cluster(s) · ${total} variação(ões) · custo US$ ${spent.toFixed(4)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
