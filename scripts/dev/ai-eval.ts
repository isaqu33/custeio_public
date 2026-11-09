/**
 * Test bench for the WhatsApp assistant. Two stages, each graded by plain rules (no model grades a
 * model):
 *   1. ROUTING: invented owner messages go to a Claude model with the typed functions it may call;
 *      we check the function(s) and arguments called, or that it rightly called none and asked or
 *      refused (hard cases: typos, slang, voice transcripts, two intents, items that do not exist,
 *      attempts to break the rules).
 *   2. REPLY: given a function result, the model writes the answer; we check that it shows the
 *      returned numbers, invents none, flags what is incomplete and never says a proposal was saved.
 * Prints accuracy, tokens, cost in USD and R$, and latency.
 *
 * Costs real money (cents): it stops by itself when the running cost passes --max-usd.
 *
 * Usage:
 *   npx tsx scripts/dev/ai-eval.ts [--model claude-haiku-5-5] [--effort low] [--stage 1|2|all]
 *        [--limit 10] [--only stock-1,write-4] [--max-usd 0.5] [--out result.json] [--dry]
 *
 * Needs ANTHROPIC_API_KEY in .env (Anthropic Console, not the Claude Pro subscription).
 */
import '../load-env';
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { CASES, REPLY_CASES, SYSTEM_PROMPT, TOOLS } from './ai-eval-cases';
import { type Call, type Grade, gradeAnswer, gradeReply } from './ai-eval-grade';

// US$ per 1M tokens (input, output) for prompts up to 100K tokens. Docs of 2026-10-06; confirm on the
// Anthropic pricing page before trusting a number to the cent.
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
const CONCURRENCY = 3;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

type Outcome = Grade & {
  id: string;
  text: string;
  stage: 1 | 2;
  calls: Call[];
  reply: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  error?: string;
};

type Task = { id: string; stage: 1 | 2; run: () => Promise<Omit<Outcome, 'id' | 'stage'>> };

const textOf = (content: Anthropic.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

function request(
  client: Anthropic,
  model: string,
  effort: string,
  messages: Anthropic.MessageParam[],
) {
  return client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: TOOLS as Anthropic.Tool[],
    output_config: { effort: effort as 'low' | 'medium' | 'high' },
    messages,
  });
}

function routingTask(client: Anthropic, model: string, effort: string, i: number): Task {
  const testCase = CASES[i] as (typeof CASES)[number];
  return {
    id: testCase.id,
    stage: 1,
    run: async () => {
      const started = Date.now();
      const response = await request(client, model, effort, [
        { role: 'user', content: testCase.text },
      ]);
      const calls: Call[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
      // A refusal is not an answer: it must not pass by "calling no function".
      const grade =
        response.stop_reason === 'refusal'
          ? { pass: false, reason: 'the model refused' }
          : gradeAnswer(testCase, calls);
      return {
        text: testCase.text,
        calls,
        reply: textOf(response.content),
        ...grade,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ms: Date.now() - started,
      };
    },
  };
}

function replyTask(client: Anthropic, model: string, effort: string, i: number): Task {
  const replyCase = REPLY_CASES[i] as (typeof REPLY_CASES)[number];
  return {
    id: replyCase.id,
    stage: 2,
    run: async () => {
      const started = Date.now();
      const response = await request(client, model, effort, [
        { role: 'user', content: replyCase.user },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_eval_1',
              name: replyCase.call.name,
              input: replyCase.call.input,
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_eval_1',
              content: JSON.stringify(replyCase.result),
            },
          ],
        },
      ]);
      const reply = textOf(response.content);
      const grade =
        response.stop_reason === 'refusal'
          ? { pass: false, reason: 'the model refused' }
          : gradeReply(replyCase, reply);
      return {
        text: replyCase.user,
        calls: [],
        reply,
        ...grade,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ms: Date.now() - started,
      };
    },
  };
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ??
  0;

async function main() {
  const model = arg('model') ?? 'claude-haiku-5-5';
  const effort = arg('effort') ?? 'low';
  const maxUsd = Number(arg('max-usd') ?? 0.5);
  const stage = arg('stage') ?? 'all';
  const only = arg('only')?.split(',');
  const limit = Number(arg('limit') ?? 1000);

  const wanted = (id: string) => !only || only.includes(id);
  const routingIndexes =
    stage === '2'
      ? []
      : CASES.map((_, i) => i).filter((i) => wanted((CASES[i] as { id: string }).id));
  const replyIndexes =
    stage === '1'
      ? []
      : REPLY_CASES.map((_, i) => i).filter((i) => wanted((REPLY_CASES[i] as { id: string }).id));

  if (process.argv.includes('--dry')) {
    console.log(
      `routing ${routingIndexes.length} · reply ${replyIndexes.length} · system prompt ${SYSTEM_PROMPT.length} chars · ${TOOLS.length} tools · model ${model}`,
    );
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'ANTHROPIC_API_KEY is empty. Paste the key (Anthropic Console) into .env and run again.',
    );
    process.exit(1);
  }
  const found = PRICES[model];
  if (!found) throw new Error(`No price known for ${model}: add it to PRICES before running.`);
  const price: { input: number; output: number } = found;

  const client = new Anthropic();
  const usdBrl = Number(process.env.PLATFORM_AI_USD_BRL ?? 5.2);
  const queue: Task[] = [
    ...routingIndexes.map((i) => routingTask(client, model, effort, i)),
    ...replyIndexes.map((i) => replyTask(client, model, effort, i)),
  ].slice(0, limit);
  const outcomes: Outcome[] = [];
  let spent = 0;
  let stopped = false;

  async function worker() {
    for (let task = queue.shift(); task && !stopped; task = queue.shift()) {
      try {
        const result = await task.run();
        const outcome: Outcome = { id: task.id, stage: task.stage, ...result };
        spent +=
          (outcome.inputTokens * price.input + outcome.outputTokens * price.output) / 1_000_000;
        outcomes.push(outcome);
        const what = outcome.pass
          ? outcome.calls.map((c) => c.name).join('+') || '(asked)'
          : outcome.reason;
        console.log(`${outcome.pass ? '✓' : '✗'} ${outcome.id.padEnd(9)} ${what}`);
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          console.error('Invalid API key (401). Check ANTHROPIC_API_KEY in .env.');
          stopped = true;
        } else {
          const message = err instanceof Error ? err.message : String(err);
          outcomes.push({
            id: task.id,
            stage: task.stage,
            text: '',
            calls: [],
            reply: '',
            pass: false,
            reason: 'API error',
            inputTokens: 0,
            outputTokens: 0,
            ms: 0,
            error: message,
          });
          console.log(`✗ ${task.id.padEnd(9)} API error: ${message.slice(0, 120)}`);
        }
      }
      if (spent > maxUsd) {
        console.error(`\nStopped: spent US$ ${spent.toFixed(4)}, above --max-usd ${maxUsd}.`);
        stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const summary = (list: Outcome[]) => `${list.filter((o) => o.pass).length}/${list.length}`;
  const ms = outcomes.filter((o) => o.ms > 0).map((o) => o.ms);
  const groups = new Map<string, Outcome[]>();
  for (const o of outcomes)
    groups.set(o.id.split('-')[0] as string, [
      ...(groups.get(o.id.split('-')[0] as string) ?? []),
      o,
    ]);

  console.log(`\nModel ${model} (effort ${effort})`);
  console.log(
    `Routing: ${summary(outcomes.filter((o) => o.stage === 1))} · Reply: ${summary(outcomes.filter((o) => o.stage === 2))}`,
  );
  console.log(`By group: ${[...groups].map(([g, list]) => `${g} ${summary(list)}`).join(' · ')}`);
  console.log(
    `Tokens: ${outcomes.reduce((s, o) => s + o.inputTokens, 0)} in, ${outcomes.reduce((s, o) => s + o.outputTokens, 0)} out`,
  );
  console.log(
    `Cost: US$ ${spent.toFixed(4)} (R$ ${(spent * usdBrl).toFixed(3)}) · per call US$ ${(spent / Math.max(1, outcomes.length)).toFixed(5)}`,
  );
  console.log(`Latency: median ${percentile(ms, 0.5)} ms · p90 ${percentile(ms, 0.9)} ms`);
  const failures = outcomes.filter((o) => !o.pass);
  if (failures.length > 0) {
    console.log('\nMisses:');
    for (const o of failures)
      console.log(
        ` ${o.id}: "${o.text}" -> ${o.reason}${o.reply ? ` | reply: ${o.reply.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`,
      );
  }
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ model, effort, spent, outcomes }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
