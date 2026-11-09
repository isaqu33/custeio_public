/**
 * Runs the ingredient AI review for one store right here (without the worker): the same service the
 * `ai.ingredients.review` job calls. Costs real money (cents); stops past --max-usd.
 *
 * Usage: npx tsx scripts/dev/run-ai-review.ts --store <storeId> [--max-usd 1] [--force]
 */
import '../load-env';
import mongoose from 'mongoose';
import { reviewDraftIngredients } from '../../app/lib/services/ingredient-ai-review';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store is required');
  await mongoose.connect(process.env.DATABASE_URL as string);
  const summary = await reviewDraftIngredients({
    storeId,
    force: process.argv.includes('--force'),
    maxUsd: Number(arg('max-usd') ?? 1),
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`${done}/${total}`);
    },
  });
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
