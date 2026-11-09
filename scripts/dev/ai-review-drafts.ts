/**
 * READ-ONLY proposal for the ingredients created from invoices that nobody reviewed (the "Insumos para
 * revisar" item of the dashboard). For a sample of drafts it asks Claude what each one is: is it part
 * of a burger restaurant's operation, a clean name, nicknames, the pack size hidden in the name, and
 * whether it is a duplicate of an ingredient that already exists. It WRITES NOTHING: the owner decides.
 *
 * Costs real money (cents): stops past --max-usd.
 *
 * Usage: npx tsx scripts/dev/ai-review-drafts.ts [--limit 20] [--step 13] [--model claude-haiku-5-5]
 *                                                [--max-usd 0.2] [--out result.json]
 */
import '../load-env';
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import RawIngredientDB from '../../app/models/raw-ingredients';

const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SCHEMA = {
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
        'Nome EXATO de um insumo da lista de existentes que seja o mesmo produto; senão null.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string', description: 'Uma frase curta com o motivo.' },
  },
} as const;

type Proposal = {
  usedByRestaurant: boolean;
  kind: string;
  cleanName: string;
  aliases: string[];
  pack: { quantity: number; unit: string } | null;
  mergeInto: string | null;
  confidence: string;
  note: string;
};

const system = (
  existing: string[],
) => `Você revisa o cadastro de insumos de uma hamburgueria brasileira. Os itens vêm de notas fiscais de supermercado e atacado: os nomes são abreviados (ex.: "Far Milho Bonoflokos Flocao Pc 400g") e a loja também compra coisas que NÃO são da operação (uso pessoal, mercado). Seja conservador: se não houver motivo claro para ser da hamburgueria, marque usedByRestaurant como false e confiança baixa.

Insumos já revisados (use o nome EXATO em mergeInto só se for o MESMO produto):
${existing.map((name) => `- ${name}`).join('\n')}`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is empty. Paste the key into .env and run again.');
    process.exit(1);
  }
  const model = arg('model') ?? 'claude-haiku-5-5';
  const price = PRICES[model];
  if (!price) throw new Error(`No price known for ${model}`);
  const limit = Number(arg('limit') ?? 20);
  const step = Number(arg('step') ?? 13);
  const maxUsd = Number(arg('max-usd') ?? 0.2);
  const usdBrl = Number(process.env.PLATFORM_AI_USD_BRL ?? 5.2);

  await mongoose.connect(process.env.DATABASE_URL as string);
  const reviewed = await RawIngredientDB.find({ isDraft: { $ne: true } })
    .select('name')
    .lean<Array<{ name: string }>>();
  const drafts = await RawIngredientDB.find({ isDraft: true })
    .select('name unit kind lastPurchase.supplierName')
    .sort({ name: 1 })
    .lean<
      Array<{ name: string; unit: string; kind?: string; lastPurchase?: { supplierName?: string } }>
    >();
  const sample = drafts.filter((_, i) => i % step === 0).slice(0, limit);
  await mongoose.disconnect();

  const client = new Anthropic();
  const existing = reviewed.map((r) => r.name);
  let spent = 0;
  const rows: Array<{ name: string; unit: string; proposal: Proposal }> = [];

  for (const draft of sample) {
    if (spent > maxUsd) {
      console.error(`Stopped: spent US$ ${spent.toFixed(4)} above --max-usd ${maxUsd}.`);
      break;
    }
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: system(existing),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Item: "${draft.name}" (cadastrado em ${draft.unit}; fornecedor: ${draft.lastPurchase?.supplierName ?? '—'}; tipo atual: ${draft.kind ?? 'food'})`,
        },
      ],
    });
    spent +=
      (response.usage.input_tokens * price.input + response.usage.output_tokens * price.output) /
      1_000_000;
    const text =
      response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
    rows.push({ name: draft.name, unit: draft.unit, proposal: JSON.parse(text) as Proposal });
  }

  for (const { name, unit, proposal: p } of rows) {
    const pack = p.pack ? `${p.pack.quantity} ${p.pack.unit}` : '—';
    console.log(`${p.usedByRestaurant ? '●' : '○'} ${name}  [${unit}]`);
    console.log(
      `    → ${p.cleanName} | ${p.kind} | embalagem ${pack} | juntar com: ${p.mergeInto ?? '—'} | apelidos: ${p.aliases.join(', ') || '—'} | ${p.confidence}`,
    );
    console.log(`    ${p.note}`);
  }
  const used = rows.filter((r) => r.proposal.usedByRestaurant).length;
  console.log(
    `\n${rows.length} item(ns) · da operação: ${used} · fora: ${rows.length - used} · custo US$ ${spent.toFixed(4)} (R$ ${(spent * usdBrl).toFixed(3)})`,
  );
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
