import connectDB from '@/app/lib/connect-db';
import { toObjectId } from '@/app/lib/mongo-id';
import { SEFAZ_DIST_HOURLY_LIMIT, type SefazEnvironment } from '@/app/lib/sefaz-client';
import SefazRequestDB from '@/app/models/sefaz-requests';

const WINDOW_MS = 60 * 60 * 1000;

export type SefazRequestRecord = {
  storeId: string;
  tpAmb: SefazEnvironment;
  cStat: string;
  xMotivo?: string;
  ultNSU?: string;
  maxNSU?: string;
  documentsCount: number;
  blockedUntil?: Date;
  retroactive?: boolean;
  simulated?: boolean;
  at?: Date;
};

export type SefazEnvironmentUsage = {
  usedLastHour: number;
  limit: number;
  // Only while a 656 block is still running.
  blockedUntil?: string;
};

export type SefazStoreUsage = {
  production: SefazEnvironmentUsage;
  homologation: SefazEnvironmentUsage;
  lastRequestAt: string;
  lastTpAmb: SefazEnvironment;
  lastCStat: string;
};

type UsageRow = { tpAmb: number; cStat: string; at: Date; blockedUntil?: Date };

/** Logs one call SEFAZ answered. Transport failures are not logged: SEFAZ never
 * saw them, so they don't count toward its ceiling. */
export async function recordSefazRequest(input: SefazRequestRecord): Promise<void> {
  await connectDB();
  await SefazRequestDB.create({
    storeId: toObjectId(input.storeId),
    tpAmb: input.tpAmb,
    cStat: input.cStat,
    xMotivo: input.xMotivo,
    ultNSU: input.ultNSU,
    maxNSU: input.maxNSU,
    documentsCount: input.documentsCount,
    blockedUntil: input.blockedUntil,
    retroactive: input.retroactive ?? false,
    simulated: input.simulated ?? false,
    at: input.at ?? new Date(),
  });
}

/** cStat of a call that was reserved but never settled — the worker died, or the
 * transport failed after SEFAZ may have seen it. Counts toward the hour either way. */
export const SEFAZ_PENDING_CSTAT = 'pending';

/**
 * Books a call in the usage log BEFORE it is made. Logging only afterwards left a
 * hole: a worker killed between SEFAZ answering and the insert spent a real
 * query from the 20/h ceiling that nothing counted. A reserved row counts like a
 * real one; `settleSefazRequest` fills in the answer. Returns the row id.
 */
export async function reserveSefazRequest(input: {
  storeId: string;
  tpAmb: SefazEnvironment;
  simulated?: boolean;
}): Promise<string> {
  await connectDB();
  const row = await SefazRequestDB.create({
    storeId: toObjectId(input.storeId),
    tpAmb: input.tpAmb,
    cStat: SEFAZ_PENDING_CSTAT,
    documentsCount: 0,
    simulated: input.simulated ?? false,
    at: new Date(),
  });
  return String(row._id);
}

/** Fills in what SEFAZ answered (or why the call failed) on a reserved row. */
export async function settleSefazRequest(
  requestId: string,
  answer: Omit<SefazRequestRecord, 'storeId' | 'tpAmb' | 'at' | 'retroactive'>,
): Promise<void> {
  await connectDB();
  await SefazRequestDB.updateOne({ _id: requestId }, { $set: answer });
}

/**
 * Pure: turns one store's logged calls into the numbers SEFAZ enforces — calls
 * inside the trailing hour per environment (a sliding window, like SEFAZ's own
 * count, not a clock-hour bucket) and whether a 656 block is still running.
 * `null` when the store never called SEFAZ.
 */
export function summarizeSefazUsage(rows: UsageRow[], now: Date): SefazStoreUsage | null {
  if (rows.length === 0) return null;

  const since = now.getTime() - WINDOW_MS;
  const usageFor = (tpAmb: SefazEnvironment): SefazEnvironmentUsage => {
    const own = rows.filter((row) => row.tpAmb === tpAmb);
    const blocked = own
      .map((row) => row.blockedUntil)
      .filter((until): until is Date => !!until && until.getTime() > now.getTime())
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      usedLastHour: own.filter((row) => row.at.getTime() >= since).length,
      limit: SEFAZ_DIST_HOURLY_LIMIT,
      blockedUntil: blocked?.toISOString(),
    };
  };

  const last = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!last) return null;
  return {
    production: usageFor(1),
    homologation: usageFor(2),
    lastRequestAt: last.at.toISOString(),
    lastTpAmb: last.tpAmb as SefazEnvironment,
    lastCStat: last.cStat,
  };
}

/** Per-store SEFAZ usage for the given stores; stores with no calls are omitted. */
export async function getSefazUsageByStore(
  storeIds: string[],
  now: Date = new Date(),
): Promise<Map<string, SefazStoreUsage>> {
  const result = new Map<string, SefazStoreUsage>();
  if (storeIds.length === 0) return result;

  await connectDB();
  // Only the last hour matters for the counters; the latest call overall comes
  // from a separate cheap lookup so an idle store still shows its last answer.
  const since = new Date(now.getTime() - WINDOW_MS);
  const objectIds = storeIds.map((id) => toObjectId(id));
  const [recent, latest, blocks] = await Promise.all([
    SefazRequestDB.find({
      storeId: { $in: objectIds },
      simulated: { $ne: true },
      at: { $gte: since },
    })
      .select('storeId tpAmb cStat at')
      .lean<Array<{ storeId: unknown } & UsageRow>>(),
    SefazRequestDB.aggregate<{ _id: unknown } & UsageRow>([
      { $match: { storeId: { $in: objectIds }, simulated: { $ne: true } } },
      { $sort: { at: -1 } },
      {
        $group: {
          _id: '$storeId',
          tpAmb: { $first: '$tpAmb' },
          cStat: { $first: '$cStat' },
          at: { $first: '$at' },
        },
      },
    ]),
    SefazRequestDB.find({
      storeId: { $in: objectIds },
      simulated: { $ne: true },
      blockedUntil: { $gt: now },
    })
      .select('storeId tpAmb cStat at blockedUntil')
      .lean<Array<{ storeId: unknown } & UsageRow>>(),
  ]);

  for (const storeId of storeIds) {
    const key = String(storeId);
    const rows: UsageRow[] = [
      ...recent.filter((row) => String(row.storeId) === key),
      ...blocks.filter((row) => String(row.storeId) === key),
      ...latest.filter((row) => String(row._id) === key),
    ];
    // `latest` and `recent` can carry the same call twice; that would double
    // count it toward the hour, so dedupe by environment + timestamp.
    const unique = rows.filter(
      (row, index) =>
        rows.findIndex((o) => o.tpAmb === row.tpAmb && o.at.getTime() === row.at.getTime()) ===
        index,
    );
    const usage = summarizeSefazUsage(unique, now);
    if (usage) result.set(key, usage);
  }
  return result;
}
