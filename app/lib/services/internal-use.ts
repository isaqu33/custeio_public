import type { LeanDoc } from '@/app/lib/mongoose-types';
import connectDB from '@/app/lib/connect-db';
import { BadRequestError, NotFoundError } from '@/app/lib/errors';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import { roundQuantity } from '@/app/lib/quantity-format';
import {
  deleteMovement,
  type OutflowReason,
  recordOutflowMovement,
} from '@/app/lib/services/stock-movements';
import RawIngredientDB from '@/app/models/raw-ingredients';
import StockMovementDB from '@/app/models/stock-movements';

// "Consumo interno" (docs/domain/non-sale-stock-outflows.md): stock that left with no sale — an
// employee took a meat, a courtesy, a donation. It goes out of stock at the ingredient's average
// cost of that moment (what the person owes, never the selling price) and the entry keeps who took
// it. It is a label, not an account: no payments, no balance — that would be a ledger of people.

export const INTERNAL_USE_REASONS = ['employee', 'courtesy', 'donation', 'other'] as const;
export type InternalUseReason = (typeof INTERNAL_USE_REASONS)[number];

// "Avaria" (the same file, the same mechanics): stock that spoiled, expired, broke or arrived
// damaged. No person: it is not taken by anybody, it is lost.
export const WASTE_REASONS = ['expired', 'breakage', 'receiving_damage', 'other'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

type OutflowType = 'internal_use' | 'waste';

const roundMoney = (value: number) => Number(value.toFixed(4));

/** Collapses spaces and drops the name when nothing is left of it. */
export function normalizePersonName(name: string | undefined): string | undefined {
  const cleaned = name?.replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || undefined;
}

export type InternalUseResult = {
  /** True when this exact entry (same requestId) was already registered; nothing changed. */
  duplicate: boolean;
  totalValue: number;
  lines: Array<{
    rawIngredientId: string;
    name: string;
    unit: string;
    quantity: number;
    unitCost: number;
    value: number;
  }>;
};

type EntryFields = {
  storeId: string;
  requestId: string;
  reason: OutflowReason;
  personName?: string;
  note?: string;
  userId?: string;
};

/**
 * One ingredient of the entry. The ledger row is written first and is what makes a repeat of the
 * same `requestId` a no-op; the stock move comes after it and the row is taken back if it fails.
 */
async function takeOut(
  type: OutflowType,
  entry: EntryFields,
  line: { rawIngredientId: string; quantity: number },
  doc: LeanDoc,
): Promise<{ duplicate: boolean; row: InternalUseResult['lines'][number] }> {
  const quantity = roundQuantity(line.quantity);
  if (quantity <= 0) throw new BadRequestError('Invalid quantity.');
  const unitCost = Number(doc.averageCost ?? 0);

  const movement = await recordOutflowMovement({
    type,
    storeId: entry.storeId,
    rawIngredientId: line.rawIngredientId,
    entryId: entry.requestId,
    quantity,
    unitCost,
    reason: entry.reason,
    personName: entry.personName,
    note: entry.note?.trim() || undefined,
    userId: entry.userId,
  });
  if (movement !== 'duplicate') {
    try {
      await RawIngredientDB.updateOne(
        { _id: toObjectId(line.rawIngredientId) },
        { $inc: { currentStock: -quantity } },
      );
    } catch (err) {
      await deleteMovement(movement.id);
      throw err;
    }
  }
  return {
    duplicate: movement === 'duplicate',
    row: {
      rawIngredientId: line.rawIngredientId,
      name: String(doc.name),
      unit: String(doc.unit),
      quantity,
      unitCost,
      value: roundMoney(quantity * unitCost),
    },
  };
}

type OutflowInput = EntryFields & { lines: Array<{ rawIngredientId: string; quantity: number }> };

/** Takes the lines of an entry out of stock at their average cost, one ledger row each. */
async function registerOutflow(type: OutflowType, input: OutflowInput): Promise<InternalUseResult> {
  const ids = input.lines.map((line) => line.rawIngredientId);
  if (new Set(ids).size !== ids.length) throw new BadRequestError('An ingredient is listed twice.');

  await connectDB();
  const docs = await RawIngredientDB.find({
    _id: { $in: toObjectIds(ids) },
    storeId: toObjectId(input.storeId),
  })
    .select('name unit averageCost')
    .lean<LeanDoc[]>();
  if (docs.length !== ids.length) throw new NotFoundError('Ingredient not found.');
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const results = [];
  for (const line of input.lines) {
    results.push(await takeOut(type, input, line, byId.get(line.rawIngredientId) as LeanDoc));
  }
  const lines = results.map((result) => result.row);
  return {
    duplicate: results.every((result) => result.duplicate),
    totalValue: roundMoney(lines.reduce((sum, row) => sum + row.value, 0)),
    lines,
  };
}

/** Consumo interno: who took it is required when an employee did. */
export async function registerInternalUse(input: OutflowInput): Promise<InternalUseResult> {
  const personName = normalizePersonName(input.personName);
  if (input.reason === 'employee' && !personName) throw new BadRequestError('Inform who took it.');
  return registerOutflow('internal_use', { ...input, personName });
}

/** Avaria: stock lost to spoilage, expiry, breakage or damage on arrival. Never carries a person. */
export async function registerWaste(input: OutflowInput): Promise<InternalUseResult> {
  return registerOutflow('waste', { ...input, personName: undefined });
}

// ---- Summary -----------------------------------------------------------------------------

// The PDV's local time (UTC-3, no daylight saving since 2019): a month starts at 03:00 UTC.
const LOCAL_OFFSET_HOURS = 3;

/** `YYYY-MM` (or this month, in local time) as the [from, to) range and the canonical key. */
export function monthRange(
  month: string | undefined,
  now: Date = new Date(),
): { key: string; from: Date; to: Date } {
  const match = month?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  const local = new Date(now.getTime() - LOCAL_OFFSET_HOURS * 3_600_000);
  const year = match ? Number(match[1]) : local.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : local.getUTCMonth();
  return {
    key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    from: new Date(Date.UTC(year, monthIndex, 1, LOCAL_OFFSET_HOURS)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1, LOCAL_OFFSET_HOURS)),
  };
}

export type InternalUsePersonTotal = {
  personName: string;
  entries: number;
  totalValue: number;
  lastAt: string;
};

export type InternalUseRow = {
  _id: string;
  occurredAt: string;
  personName?: string;
  reason: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  value: number;
  note?: string;
};

export type InternalUseSummary = {
  month: string;
  totalValue: number;
  byPerson: InternalUsePersonTotal[];
  byReason: Array<{ reason: string; totalValue: number }>;
  rows: InternalUseRow[];
};

type PersonGroup = { name: string; entries: string[]; total: number; lastAt: Date };

/** What left as internal use in a month: R$ at cost per person and per reason, and the rows. */
export async function getInternalUseSummary(
  storeId: string,
  params: { month?: string } = {},
): Promise<InternalUseSummary> {
  await connectDB();
  const range = monthRange(params.month);
  const match = {
    storeId: toObjectId(storeId),
    type: 'internal_use' as const,
    occurredAt: { $gte: range.from, $lt: range.to },
  };

  const [people, reasons, docs] = await Promise.all([
    StockMovementDB.aggregate<{ _id: string } & PersonGroup>([
      { $match: match },
      {
        $group: {
          _id: { $toLower: { $ifNull: ['$personName', ''] } },
          name: { $first: '$personName' },
          entries: { $addToSet: '$source.entryId' },
          total: { $sum: '$value' },
          lastAt: { $max: '$occurredAt' },
        },
      },
      { $sort: { total: -1 } },
    ]),
    StockMovementDB.aggregate<{ _id: string; total: number }>([
      { $match: match },
      { $group: { _id: '$reason', total: { $sum: '$value' } } },
      { $sort: { total: -1 } },
    ]),
    StockMovementDB.find(match).sort({ occurredAt: -1, _id: -1 }).limit(200).lean<LeanDoc[]>(),
  ]);

  const names = new Map(
    (
      await RawIngredientDB.find({
        _id: { $in: docs.map((doc) => doc.rawIngredientId) },
      })
        .select('name unit')
        .lean<LeanDoc[]>()
    ).map((doc) => [String(doc._id), doc]),
  );

  const byPerson = people.map((group) => ({
    personName: group.name ?? '',
    entries: group.entries.length,
    totalValue: roundMoney(group.total),
    lastAt: group.lastAt.toISOString(),
  }));

  return {
    month: range.key,
    totalValue: roundMoney(byPerson.reduce((sum, person) => sum + person.totalValue, 0)),
    byPerson,
    byReason: reasons.map((row) => ({
      reason: String(row._id),
      totalValue: roundMoney(row.total),
    })),
    rows: docs.map((doc) => {
      const ingredient = names.get(String(doc.rawIngredientId));
      return {
        _id: String(doc._id),
        occurredAt: (doc.occurredAt as Date).toISOString(),
        personName: doc.personName ? String(doc.personName) : undefined,
        reason: String(doc.reason ?? 'other'),
        ingredientName: String(ingredient?.name ?? ''),
        unit: String(ingredient?.unit ?? ''),
        quantity: Math.abs(Number(doc.quantity)),
        unitCost: Number(doc.unitCost ?? 0),
        value: Number(doc.value ?? 0),
        note: doc.note ? String(doc.note) : undefined,
      };
    }),
  };
}

/** Names already used in this store, to suggest while typing (so "João" is not typed three ways). */
export async function listInternalUsePeople(storeId: string): Promise<string[]> {
  await connectDB();
  const names = await StockMovementDB.distinct('personName', {
    storeId: toObjectId(storeId),
    type: 'internal_use',
    personName: { $exists: true, $ne: '' },
  });
  return names.sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 100);
}

// ---- Avarias summary ---------------------------------------------------------------------

export type WasteRow = {
  _id: string;
  occurredAt: string;
  reason: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  value: number;
  note?: string;
};

export type WasteSummary = {
  month: string;
  totalValue: number;
  byReason: Array<{ reason: string; totalValue: number }>;
  /** What was lost the most, in R$, so the owner sees where the money goes. */
  byIngredient: Array<{
    ingredientName: string;
    unit: string;
    quantity: number;
    totalValue: number;
  }>;
  rows: WasteRow[];
};

/** What was lost as avaria in a month: R$ at cost per reason and per ingredient, and the rows. */
export async function getWasteSummary(
  storeId: string,
  params: { month?: string } = {},
): Promise<WasteSummary> {
  await connectDB();
  const range = monthRange(params.month);
  const match = {
    storeId: toObjectId(storeId),
    type: 'waste' as const,
    occurredAt: { $gte: range.from, $lt: range.to },
  };
  const docs = await StockMovementDB.find(match)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(500)
    .lean<LeanDoc[]>();
  const ingredients = new Map(
    (
      await RawIngredientDB.find({ _id: { $in: docs.map((doc) => doc.rawIngredientId) } })
        .select('name unit')
        .lean<LeanDoc[]>()
    ).map((doc) => [String(doc._id), doc]),
  );

  const rows = docs.map((doc): WasteRow => {
    const ingredient = ingredients.get(String(doc.rawIngredientId));
    return {
      _id: String(doc._id),
      occurredAt: (doc.occurredAt as Date).toISOString(),
      reason: String(doc.reason ?? 'other'),
      ingredientName: String(ingredient?.name ?? ''),
      unit: String(ingredient?.unit ?? ''),
      quantity: Math.abs(Number(doc.quantity)),
      value: Number(doc.value ?? 0),
      note: doc.note ? String(doc.note) : undefined,
    };
  });

  const reasons = new Map<string, number>();
  const perIngredient = new Map<string, WasteSummary['byIngredient'][number]>();
  for (const row of rows) {
    reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + row.value);
    const entry = perIngredient.get(row.ingredientName) ?? {
      ingredientName: row.ingredientName,
      unit: row.unit,
      quantity: 0,
      totalValue: 0,
    };
    entry.quantity += row.quantity;
    entry.totalValue += row.value;
    perIngredient.set(row.ingredientName, entry);
  }
  const byValue = <T extends { totalValue: number }>(a: T, b: T) => b.totalValue - a.totalValue;

  return {
    month: range.key,
    totalValue: roundMoney(rows.reduce((sum, row) => sum + row.value, 0)),
    byReason: [...reasons]
      .map(([reason, value]) => ({ reason, totalValue: roundMoney(value) }))
      .sort(byValue),
    byIngredient: [...perIngredient.values()]
      .map((entry) => ({
        ...entry,
        quantity: roundQuantity(entry.quantity),
        totalValue: roundMoney(entry.totalValue),
      }))
      .sort(byValue)
      .slice(0, 10),
    rows,
  };
}
