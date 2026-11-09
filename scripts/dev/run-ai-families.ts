/**
 * Groups a store's ingredients into families right here (without the worker): the last step of the
 * `ai.ingredients.review` job. Writes `familyOf` (reversible in the ingredient's form). Costs cents.
 *
 * Usage: npx tsx scripts/dev/run-ai-families.ts --store <storeId> [--max-usd 0.3]
 */
import '../load-env';
import mongoose from 'mongoose';
import { groupIngredientFamilies } from '../../app/lib/services/ingredient-families';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store is required');
  await mongoose.connect(process.env.DATABASE_URL as string);
  console.log(
    JSON.stringify(
      await groupIngredientFamilies({ storeId, maxUsd: Number(arg('max-usd') ?? 0.3) }),
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
