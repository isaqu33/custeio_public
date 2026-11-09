/**
 * SPIKE — can an LLM draft a "ficha técnica" from the menu text and the store's own ingredients?
 *
 * Reads the store's products and ingredients, asks Gemini (structured JSON output) for a draft recipe
 * per product, VALIDATES it in code, and PRINTS it. Writes nothing to the database. Where the owner
 * already filled a recipe, it is shown next to the draft as the gold standard.
 *
 * The product descriptions are not stored by the catalog sync yet, so the script fetches the menu once
 * from Alloy (1 request of the store's 2/min quota) just to read them.
 *
 * GEMINI_API_KEY is read from .env (never printed). The free tier may use what is sent to improve
 * Google's products: fine for the lab store's menu and ingredient names, not for a paying client.
 *
 * Usage:
 *   npx tsx scripts/dev/recipe-draft-spike.ts --list-models [--use-platform-key]
 *   npx tsx scripts/dev/recipe-draft-spike.ts --store <storeId> [--only "Sansão,Casa"] [--limit 3] \
 *     [--model gemini-2.5-flash] [--delay-ms 7000] [--gold]
 *
 * --gold   run on the products that already have a recipe, to compare the draft with it.
 */
import '../load-env';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../../app/lib/env';
import { reserveAlloyRequest } from '../../app/lib/alloy-rate-limit';
import { decryptSecret } from '../../app/lib/secret-encryption';
import PartnerProducts from '../../app/models/partner-products';
import ProductRecipes from '../../app/models/product-recipes';
import RawIngredients from '../../app/models/raw-ingredients';
import StoreDB from '../../app/models/stores';

const API = 'https://generativelanguage.googleapis.com/v1beta';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// GEMINI_API_KEY by default. `--use-platform-key` opts in to the PLATFORM_AI_API_KEY of the old analysis
// pipeline instead — only after checking that it is a free-tier key, since a billed one would cost money.
const apiKey = flag('use-platform-key')
  ? process.env.PLATFORM_AI_API_KEY
  : process.env.GEMINI_API_KEY;
const headers = () => ({ 'content-type': 'application/json', 'x-goog-api-key': apiKey as string });

// ---------------------------------------------------------------------------------------------
// What the model must answer. Validated again in code: the schema only shapes the output, it does
// not make it true.
// ---------------------------------------------------------------------------------------------
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ingredient: { type: 'INTEGER', description: 'The number of the ingredient in the list' },
          quantity: {
            type: 'NUMBER',
            description: 'Amount for ONE unit of the product, in the ingredient unit',
          },
          source: { type: 'STRING', enum: ['description', 'standard', 'inferred'] },
          note: { type: 'STRING' },
        },
        required: ['ingredient', 'quantity', 'source'],
      },
    },
    missing: {
      type: 'ARRAY',
      description: 'Things the product needs that no listed ingredient can be',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['name'],
      },
    },
  },
  required: ['lines'],
};

const Draft = z.object({
  lines: z.array(
    z.object({
      ingredient: z.number().int(),
      quantity: z.number(),
      source: z.enum(['description', 'standard', 'inferred']),
      note: z.string().optional(),
    }),
  ),
  missing: z.array(z.object({ name: z.string(), why: z.string().optional() })).optional(),
});

const SYSTEM = `You build the "ficha técnica" (recipe card) of a Brazilian burger restaurant's menu item.
You are given ONE menu item (name, category, description) and the numbered list of the ingredients
the restaurant buys (name and unit). Answer with the ingredients that go into ONE unit of the item.

Rules:
- Use ONLY ingredients from the list, by their number. Never invent one. If the item needs something the
  list does not have (a house-made sauce, caramelized onion), put it in "missing" instead.
- "quantity" is in the unit shown for that ingredient (g, ml or un). A burger patty or bun in "un" is 1.
- "source": "description" when the item text states it (e.g. "blend de 150g" => the 150 g patty),
  "standard" when you apply a usual portion, "inferred" when you are guessing. Be honest: prefer
  "inferred" over a confident wrong number.
- Choose ONE ingredient per role. Several brands of the same thing may exist (several mayonnaises,
  cheddars, bacons): pick the most plausible and say why in "note".
- Usual portions for a burger restaurant (use when the text is silent, source "standard"): bread 1 un;
  cheese slice 20 g; creamy cheddar 10-20 g; bacon 20-30 g; lettuce 10 g; tomato 25 g; onion 15 g;
  sauce 30 ml/g; fries portion 150 g.
- Items whose name says "+ Fritas" include one fries portion; "Combo" items are the sum of their parts.
- Do not include drinks unless the item is a drink (a drink is 1 un of the matching bottle/can).
- Items marked "(grátis)" or a free soda are chosen by the store: put them in "missing".
Answer ONLY with JSON.`;

async function listModels() {
  const response = await fetch(`${API}/models?pageSize=200`, { headers: headers() });
  const body = (await response.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  if (!response.ok)
    throw new Error(`models: HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  for (const model of body.models ?? []) {
    if (model.supportedGenerationMethods?.includes('generateContent'))
      console.log(model.name.replace('models/', ''));
  }
}

/**
 * One request to Alloy for the menu, only to read the descriptions. Cached for a day in the temp folder:
 * a spike is run many times in a row and the store only has 2 Alloy requests per minute.
 */
async function fetchDescriptions(storeId: string): Promise<Map<string, string>> {
  const cacheFile = join(tmpdir(), `custeio-menu-descriptions-${storeId}.json`);
  if (existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < 24 * 60 * 60 * 1000) {
    return new Map(
      Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, string>),
    );
  }
  const fresh = await fetchDescriptionsFromAlloy(storeId);
  writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(fresh)));
  return fresh;
}

async function fetchDescriptionsFromAlloy(storeId: string): Promise<Map<string, string>> {
  const store = await StoreDB.findById(storeId).select('apiKey').lean<{ apiKey?: string } | null>();
  if (!store?.apiKey) throw new Error('Store not found or without an Alloy key.');
  if (!env.ALLOY_INTEGRATOR_TOKEN || !env.ALLOY_API_HOST)
    throw new Error('Alloy is not configured.');
  if (!(await reserveAlloyRequest(storeId)))
    throw new Error('Store quota for this minute is spent; wait and run again.');

  const response = await fetch(`https://api.${env.ALLOY_API_HOST}/api/catalog/getproducts`, {
    headers: {
      Authorization: `Bearer ${decryptSecret(store.apiKey)}`,
      'integrador-token': env.ALLOY_INTEGRATOR_TOKEN,
    },
  });
  const body = (await response.json()) as {
    produtos?: Array<{ items?: Array<{ id?: number | string; descricao?: string | null }> }>;
  };
  const out = new Map<string, string>();
  for (const category of body.produtos ?? []) {
    for (const item of category.items ?? []) {
      if (item.id !== undefined && item.descricao)
        out.set(String(item.id), String(item.descricao).replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };

async function callGemini(
  model: string,
  userText: string,
): Promise<{ json: unknown; usage?: Usage; ms: number }> {
  const call = async (withSchema: boolean) => {
    const started = Date.now();
    const response = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          ...(withSchema && { responseSchema: RESPONSE_SCHEMA }),
        },
      }),
    });
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: Usage;
      error?: { code?: number; message?: string; status?: string };
    };
    return { response, body, ms: Date.now() - started };
  };

  let attempt = await call(true);
  // A schema the model rejects: ask for JSON in the prompt only, and validate in code anyway.
  if (
    attempt.response.status === 400 &&
    /schema|response_schema|responseSchema/i.test(attempt.body.error?.message ?? '')
  ) {
    console.log('  (schema rejected by the API; retrying with JSON mode only)');
    attempt = await call(false);
  }
  // Busy (503) or rate limited (429): wait and try again, a few times.
  for (const waitSeconds of [10, 25, 45]) {
    if (attempt.response.status !== 429 && attempt.response.status !== 503) break;
    console.log(`  (HTTP ${attempt.response.status}; waiting ${waitSeconds} s and retrying)`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    attempt = await call(true);
  }
  if (!attempt.response.ok) {
    throw new Error(
      `Gemini HTTP ${attempt.response.status}: ${attempt.body.error?.message ?? 'unknown error'}`,
    );
  }
  const text =
    attempt.body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text)
    throw new Error(
      `Empty answer (finishReason ${attempt.body.candidates?.[0]?.finishReason ?? 'n/a'}).`,
    );
  return { json: JSON.parse(text), usage: attempt.body.usageMetadata, ms: attempt.ms };
}

const CAPS: Record<string, number> = { g: 1000, ml: 1000, un: 10 };
const money = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;
const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  if (!apiKey) {
    throw new Error(
      flag('use-platform-key')
        ? 'PLATFORM_AI_API_KEY is not set.'
        : 'GEMINI_API_KEY is not set (put it in .env or .env.local).',
    );
  }
  if (flag('list-models')) return listModels();

  const storeId = arg('store');
  if (!storeId) throw new Error('--store <storeId> is required (or use --list-models).');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(env.DATABASE_URL);
  const store = new mongoose.Types.ObjectId(storeId);
  const model = arg('model') ?? process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const delayMs = Number(arg('delay-ms') ?? 7000);

  // The ingredients the model may choose from: what the restaurant cooks with and packs with.
  const ingredientDocs = await RawIngredients.find({
    storeId: store,
    kind: { $in: ['food', 'packaging'] },
  })
    .select('name unit averageCost')
    .sort({ name: 1 })
    .lean<Array<{ _id: unknown; name: string; unit: string; averageCost: number }>>();
  const catalog = ingredientDocs.map((doc, index) => ({
    n: index + 1,
    id: String(doc._id),
    ...doc,
  }));
  const listText = catalog.map((i) => `${i.n}. ${i.name} (${i.unit})`).join('\n');
  console.log(`model ${model} · ${catalog.length} ingredients offered · no database write\n`);

  // Products to draft.
  // Rows synced before the `channel` field existed have none: they are the store's own menu.
  const products = await PartnerProducts.find({
    storeId: store,
    isActive: true,
    channel: { $nin: ['ifood', 'didifood'] },
  })
    .select('name codPdv externalId categoryName sellingPrice')
    .sort({ name: 1 })
    .lean<
      Array<{
        name: string;
        codPdv?: string;
        externalId: string;
        categoryName?: string;
        sellingPrice: number;
      }>
    >();
  const shared = await ProductRecipes.find({ storeId: store, kind: 'product' }).lean<
    Array<{ codPdv: string; recipe: Array<{ rawIngredientId: unknown; quantity: number }> }>
  >();
  const goldByCode = new Map(shared.map((s) => [s.codPdv, s.recipe]));

  const only = (arg('only') ?? '')
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);
  let picked = products.filter((p) => {
    if (flag('gold')) return Boolean(p.codPdv && goldByCode.has(p.codPdv));
    if (only.length > 0) return only.some((o) => normalize(p.name).includes(o));
    return !p.codPdv || !goldByCode.has(p.codPdv);
  });
  picked = picked.slice(0, Number(arg('limit') ?? 3));
  if (picked.length === 0) throw new Error('No product matched.');

  const descriptions = await fetchDescriptions(storeId);
  let totalTokens = 0;

  for (const [position, product] of picked.entries()) {
    const description = descriptions.get(product.externalId) ?? '';
    console.log(
      `━━ ${product.name}  (${money(product.sellingPrice)})${product.codPdv ? `  [cod ${product.codPdv}]` : ''}`,
    );
    console.log(`   texto: ${description || '(sem descrição no cardápio)'}`);

    const prompt = `ITEM: ${product.name}
CATEGORY: ${product.categoryName ?? ''}
DESCRIPTION: ${description || '(none)'}

INGREDIENTS (number. name (unit)):
${listText}`;

    try {
      const { json, usage, ms } = await callGemini(model, prompt);
      totalTokens += usage?.totalTokenCount ?? 0;
      const draft = Draft.parse(json);

      // Validation in code: the model only suggests.
      let cost = 0;
      const seen = new Set<number>();
      for (const line of draft.lines) {
        const ingredient = catalog[line.ingredient - 1];
        const problems: string[] = [];
        if (!ingredient) problems.push('ingredient number does not exist');
        if (seen.has(line.ingredient)) problems.push('repeated');
        seen.add(line.ingredient);
        if (!(line.quantity > 0)) problems.push('quantity not positive');
        if (ingredient && line.quantity > (CAPS[ingredient.unit] ?? 10))
          problems.push(`implausible (> ${CAPS[ingredient.unit]} ${ingredient.unit})`);
        const lineCost = ingredient ? line.quantity * ingredient.averageCost : 0;
        if (problems.length === 0) cost += lineCost;
        console.log(
          `   ${problems.length ? '✗' : '•'} ${(ingredient?.name ?? `#${line.ingredient}?`).padEnd(46)} ${String(line.quantity).padStart(7)} ${ingredient?.unit ?? ''}`.padEnd(
            70,
          ) +
            ` ${line.source.padEnd(11)} ${ingredient ? money(lineCost) : ''}${line.note ? `  — ${line.note}` : ''}${problems.length ? `  ⚠ ${problems.join(', ')}` : ''}`,
        );
      }
      for (const miss of draft.missing ?? [])
        console.log(`   ? falta no sistema: ${miss.name}${miss.why ? ` (${miss.why})` : ''}`);
      const margin =
        product.sellingPrice > 0 ? ((product.sellingPrice - cost) / product.sellingPrice) * 100 : 0;
      console.log(
        `   custo estimado ${money(cost)} · margem ${margin.toFixed(1)}%  · ${usage?.totalTokenCount ?? '?'} tokens · ${ms} ms`,
      );

      const gold = product.codPdv ? goldByCode.get(product.codPdv) : undefined;
      if (gold) {
        console.log('   GABARITO (ficha do dono):');
        const byId = new Map(catalog.map((i) => [i.id, i]));
        for (const goldLine of gold) {
          const g = byId.get(String(goldLine.rawIngredientId));
          const drafted = draft.lines.find(
            (l) => catalog[l.ingredient - 1]?.id === String(goldLine.rawIngredientId),
          );
          console.log(
            `     ${g?.name ?? '?'} = ${goldLine.quantity} ${g?.unit ?? ''}  →  ${
              drafted
                ? `rascunho ${drafted.quantity} (${((drafted.quantity / goldLine.quantity) * 100).toFixed(0)}%)`
                : 'NÃO apareceu no rascunho'
            }`,
          );
        }
        const goldIds = new Set(gold.map((l) => String(l.rawIngredientId)));
        for (const l of draft.lines) {
          const id = catalog[l.ingredient - 1]?.id;
          if (id && !goldIds.has(id))
            console.log(
              `     (a mais no rascunho) ${catalog[l.ingredient - 1]?.name} = ${l.quantity}`,
            );
        }
      }
    } catch (err) {
      console.log(`   ✗ failed: ${err instanceof Error ? err.message : err}`);
    }
    console.log('');
    if (position < picked.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.log(
    `${picked.length} product(s) · ~${totalTokens} tokens in total · nothing was written.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
