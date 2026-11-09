/**
 * @jest-environment node
 */
export {};

// The sliding-hour math behind the "n/20" counter — pure, so no DB mocking.
jest.mock('@/app/lib/connect-db', () => ({ __esModule: true, default: jest.fn() }));
const createMock = jest.fn();
const updateOneMock = jest.fn();
jest.mock('@/app/models/sefaz-requests', () => ({
  __esModule: true,
  // Wrapped so the `const`s are read at call time, not while the import hoists.
  default: {
    create: (...args: unknown[]) => createMock(...args),
    updateOne: (...args: unknown[]) => updateOneMock(...args),
  },
}));

import { summarizeSefazUsage } from '@/app/lib/services/sefaz-requests';
// Lazy: the model mock closes over `const`s that are not initialized yet while
// static imports are hoisted.
const load = () => import('@/app/lib/services/sefaz-requests');

const NOW = new Date('2026-09-24T16:30:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('summarizeSefazUsage', () => {
  it('returns null for a store that never called SEFAZ', () => {
    expect(summarizeSefazUsage([], NOW)).toBeNull();
  });

  it('counts only calls inside the trailing hour (sliding, not clock-hour)', () => {
    const usage = summarizeSefazUsage(
      [
        { tpAmb: 1, cStat: '138', at: minutesAgo(5) },
        { tpAmb: 1, cStat: '137', at: minutesAgo(59) },
        { tpAmb: 1, cStat: '138', at: minutesAgo(61) }, // fell out of the window
      ],
      NOW,
    );
    expect(usage?.production).toMatchObject({ usedLastHour: 2, limit: 20 });
  });

  it('keeps production and homologação budgets apart', () => {
    const usage = summarizeSefazUsage(
      [
        { tpAmb: 1, cStat: '138', at: minutesAgo(10) },
        { tpAmb: 2, cStat: '137', at: minutesAgo(20) },
        { tpAmb: 2, cStat: '137', at: minutesAgo(30) },
      ],
      NOW,
    );
    expect(usage?.production.usedLastHour).toBe(1);
    expect(usage?.homologation.usedLastHour).toBe(2);
  });

  it('reports the latest call and a block that is still running', () => {
    const until = new Date(NOW.getTime() + 20 * 60_000);
    const usage = summarizeSefazUsage(
      [
        { tpAmb: 1, cStat: '138', at: minutesAgo(40) },
        { tpAmb: 1, cStat: '656', at: minutesAgo(40 - 1), blockedUntil: until },
      ],
      NOW,
    );
    expect(usage).toMatchObject({ lastCStat: '656', lastTpAmb: 1 });
    expect(usage?.production.blockedUntil).toBe(until.toISOString());
  });

  it('ignores a block that already ended', () => {
    const usage = summarizeSefazUsage(
      [{ tpAmb: 1, cStat: '656', at: minutesAgo(90), blockedUntil: minutesAgo(30) }],
      NOW,
    );
    expect(usage?.production.blockedUntil).toBeUndefined();
    expect(usage?.production.usedLastHour).toBe(0);
  });
});

describe('reserveSefazRequest / settleSefazRequest', () => {
  const STORE_ID = '665f735a90788d97f5a76322';

  beforeEach(() => jest.clearAllMocks());

  it('books a pending row up front and hands back its id', async () => {
    createMock.mockResolvedValue({ _id: 'row-1' });
    const { SEFAZ_PENDING_CSTAT, reserveSefazRequest } = await load();

    const id = await reserveSefazRequest({ storeId: STORE_ID, tpAmb: 1, simulated: false });

    expect(id).toBe('row-1');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ cStat: SEFAZ_PENDING_CSTAT, tpAmb: 1, simulated: false }),
    );
  });

  it('fills in the answer on the reserved row', async () => {
    const { settleSefazRequest } = await load();
    await settleSefazRequest('row-1', { cStat: '138', documentsCount: 12 });

    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: 'row-1' },
      { $set: { cStat: '138', documentsCount: 12 } },
    );
  });

  it('counts a reserved-but-unsettled call toward the hour', async () => {
    const { SEFAZ_PENDING_CSTAT } = await load();
    const usage = summarizeSefazUsage(
      [
        { tpAmb: 1, cStat: SEFAZ_PENDING_CSTAT, at: minutesAgo(2) },
        { tpAmb: 1, cStat: 'error', at: minutesAgo(3) },
      ],
      NOW,
    );
    expect(usage?.production.usedLastHour).toBe(2);
  });
});
