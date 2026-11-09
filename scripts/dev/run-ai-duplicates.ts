/**
 * Runs the duplicate search for one store right here (without the worker): the second step of the
 * `ai.ingredients.review` job. Stores PENDING suggestions only — nothing is merged. Costs cents.
 *
 * Usage: npx tsx scripts/dev/run-ai-duplicates.ts --store <storeId> [--max-usd 0.5]
 */
import '../load-env';
import mongoose from 'mongoose';
import { findDuplicateSuggestions } from '../../app/lib/services/ingredient-duplicates';
import IngredientMergeSuggestionDB from '../../app/models/ingredient-merge-suggestions';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store is required');
  await mongoose.connect(process.env.DATABASE_URL as string);
  await IngredientMergeSuggestionDB.createIndexes();
  console.log(
    JSON.stringify(
      await findDuplicateSuggestions({ storeId, maxUsd: Number(arg('max-usd') ?? 0.5) }),
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
