import { foldText } from '../../app/lib/ingredient-identity';
import type { Case, ReplyCase } from './ai-eval-cases';

// Deterministic grading: no model grades a model. A wrong function, a wrong number or an invented
// figure is a plain mismatch found by rules.

export type Call = { name: string; input: Record<string, unknown> };
export type Grade = { pass: boolean; reason: string; extras?: number };

type Items = Array<{ ingredient: string; quantity: number }>;
type Args = Record<string, string | string[] | number | Items>;

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.01);

function itemsMismatch(actual: unknown, expected: Items): string | null {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return `expected ${expected.length} item(s), got ${Array.isArray(actual) ? actual.length : 'none'}`;
  }
  for (const want of expected) {
    const found = (actual as Array<Record<string, unknown>>).find(
      (item) => foldText(String(item.ingredient ?? '')) === foldText(want.ingredient),
    );
    if (!found) return `missing "${want.ingredient}"`;
    if (!sameNumber(Number(found.quantity), want.quantity)) {
      return `"${want.ingredient}": quantity ${String(found.quantity)} instead of ${want.quantity}`;
    }
  }
  return null;
}

function argMismatch(
  key: string,
  want: string | string[] | number | Items,
  got: unknown,
): string | null {
  if (key === 'items') return itemsMismatch(got, want as Items);
  if (Array.isArray(want)) {
    const options = want as string[];
    return options.some((option) => foldText(String(got ?? '')) === foldText(option))
      ? null
      : `${key}: "${String(got)}" is none of ${options.join('/')}`;
  }
  if (typeof want === 'number') {
    return sameNumber(Number(got), want) ? null : `${key}: ${String(got)} instead of ${want}`;
  }
  return foldText(String(got ?? '')) === foldText(String(want))
    ? null
    : `${key}: "${String(got)}" instead of "${String(want)}"`;
}

function callMismatch(want: { tool: string; args?: Args }, got: Call): string | null {
  if (got.name !== want.tool) return `called ${got.name}, expected ${want.tool}`;
  for (const [key, value] of Object.entries(want.args ?? {})) {
    const problem = argMismatch(key, value, got.input[key]);
    if (problem) return problem;
  }
  return null;
}

/**
 * Matches each expected call with an actual one (any order, each used once). Calls beyond the expected
 * ones are fine when they only read (the model offered one more answer: it costs a query, harms
 * nothing) but a write proposal nobody asked for is a failure. Returns the extras it let through.
 */
function matchAll(
  wanted: Array<{ tool: string; args?: Args }>,
  calls: Call[],
): { problem: string | null; extras: Call[] } {
  if (calls.length < wanted.length) {
    return {
      problem: `${calls.length} call(s) [${calls.map((c) => c.name).join(', ') || 'none'}], expected ${wanted.length}`,
      extras: [],
    };
  }
  const remaining = [...calls];
  for (const want of wanted) {
    const index = remaining.findIndex((call) => callMismatch(want, call) === null);
    if (index === -1) {
      const near = remaining.find((call) => call.name === want.tool) ?? remaining[0];
      return { problem: near ? callMismatch(want, near) : `no call for ${want.tool}`, extras: [] };
    }
    remaining.splice(index, 1);
  }
  const write = remaining.find((call) => call.name.startsWith('propose_'));
  return write
    ? { problem: `extra write proposal ${write.name}`, extras: [] }
    : { problem: null, extras: remaining };
}

/** Did the model call the right function(s) with the right arguments (or rightly none)? */
export function gradeAnswer(testCase: Case, calls: Call[]): Grade {
  const { expect } = testCase;
  if ('noTool' in expect) {
    return calls.length > 0
      ? {
          pass: false,
          reason: `called ${calls.map((c) => c.name).join(', ')}, expected a question or a refusal (${expect.why})`,
        }
      : { pass: true, reason: expect.why };
  }
  const wanted = 'tools' in expect ? expect.tools : [expect];
  const { problem, extras } = matchAll(wanted, calls);
  if (problem) return { pass: false, reason: problem };
  return extras.length > 0
    ? { pass: true, reason: `ok (+${extras.map((c) => c.name).join(', ')})`, extras: extras.length }
    : { pass: true, reason: 'ok', extras: 0 };
}

// ---- The reply written after the function result ----

/** Every number in a text, read the Brazilian way ("1.543,85" is 1543.85; "1.500" is 1500). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.match(/\d[\d.,]*/g) ?? []) {
    const token = raw.replace(/[.,]+$/, '');
    let normalized = token;
    if (token.includes('.') && token.includes(','))
      normalized = token.replace(/\./g, '').replace(',', '.');
    else if (token.includes(',')) normalized = token.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(token)) normalized = token.replace(/\./g, '');
    const value = Number(normalized);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * Does the reply use only the numbers the function returned, show the ones that matter, flag what is
 * incomplete and never claim a proposal was saved? Small whole numbers (list markers, "2 itens") are
 * not counted as invented.
 */
export function gradeReply(replyCase: ReplyCase, text: string): Grade {
  const shown = numbersIn(text);
  for (const need of replyCase.mustMention) {
    if (!shown.some((value) => sameNumber(value, need))) {
      return { pass: false, reason: `does not show ${need}` };
    }
  }
  // What the function returned (and was asked) is fair game, names included ("Angus 150 g").
  const known = [
    ...replyCase.mustMention,
    ...replyCase.allowed,
    ...numbersIn(JSON.stringify([replyCase.call.input, replyCase.result])),
  ];
  const invented = shown.find(
    (value) => !(Number.isInteger(value) && value <= 3) && !known.some((k) => sameNumber(value, k)),
  );
  if (invented !== undefined) return { pass: false, reason: `invented number ${invented}` };
  for (const pattern of replyCase.mustMatch ?? []) {
    if (!pattern.test(text)) return { pass: false, reason: `missing ${String(pattern)}` };
  }
  for (const pattern of replyCase.mustNotMatch ?? []) {
    if (pattern.test(text)) return { pass: false, reason: `forbidden ${String(pattern)}` };
  }
  return { pass: true, reason: 'ok' };
}
