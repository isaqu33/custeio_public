/**
 * @jest-environment node
 */
export {};

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockEnv: { SEFAZ_SOURCE: string; SEFAZ_SIMULATED_DIR?: string } = {
  SEFAZ_SOURCE: 'simulated',
};
// Getters, not a plain object: the mock factory runs while imports are hoisted,
// before `mockEnv` is initialized — reading it lazily avoids that.
jest.mock('@/app/lib/env', () => ({
  env: {
    get SEFAZ_SOURCE() {
      return mockEnv.SEFAZ_SOURCE;
    },
    get SEFAZ_SIMULATED_DIR() {
      return mockEnv.SEFAZ_SIMULATED_DIR;
    },
  },
}));

import { SEFAZ_BATCH_SIZE, buildSimulatedBatch, fetchSefazBatch } from '@/app/lib/sefaz-source';

const nsu = (n: number) => String(n).padStart(15, '0');
const doc = (n: number, schema = 'procNFe_v4.00.xsd') => ({
  nsu: nsu(n),
  schema,
  xml: `<x n="${n}"/>`,
});

describe('buildSimulatedBatch', () => {
  it('serves documents after the cursor, in NSU order, whatever order they were given', () => {
    const batch = buildSimulatedBatch([doc(195), doc(193), doc(194)], nsu(193));
    expect(batch.cStat).toBe('138');
    expect(batch.documents.map((d) => d.nsu)).toEqual([nsu(194), nsu(195)]);
    expect(batch.ultNSU).toBe(nsu(195));
    expect(batch.maxNSU).toBe(nsu(195));
  });

  it('caps a batch at 50 and leaves the rest for the next call', () => {
    const files = Array.from({ length: 120 }, (_, i) => doc(i + 1));
    const first = buildSimulatedBatch(files, nsu(0));
    expect(first.documents).toHaveLength(SEFAZ_BATCH_SIZE);
    expect(first.ultNSU).toBe(nsu(50));
    expect(first.maxNSU).toBe(nsu(120));

    const second = buildSimulatedBatch(files, first.ultNSU as string);
    expect(second.documents[0]?.nsu).toBe(nsu(51));
  });

  it('answers 137 once the sequence is exhausted, like the real service', () => {
    const batch = buildSimulatedBatch([doc(1), doc(2)], nsu(2));
    expect(batch).toMatchObject({ cStat: '137', documents: [], ultNSU: nsu(2) });
  });
});

describe('fetchSefazBatch', () => {
  it('reads <NSU>-<schema>.xml files from the folder and skips everything else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sefaz-sim-'));
    writeFileSync(join(dir, `${nsu(10)}-procNFe_v4.00.xsd.xml`), '<a/>');
    writeFileSync(join(dir, `${nsu(11)}-resNFe_v1.01.xsd.xml`), '<b/>');
    writeFileSync(join(dir, `._${nsu(12)}-procNFe_v4.00.xsd.xml`), 'apple double junk');
    writeFileSync(join(dir, 'notes.txt'), 'ignore me');
    mockEnv.SEFAZ_SIMULATED_DIR = dir;

    const batch = await fetchSefazBatch({});
    expect(batch.simulated).toBe(true);
    expect(batch.documents.map((d) => [d.nsu, d.schema, d.xml])).toEqual([
      [nsu(10), 'procNFe_v4.00.xsd', '<a/>'],
      [nsu(11), 'resNFe_v1.01.xsd', '<b/>'],
    ]);
  });

  it('refuses `live` instead of quietly serving fixtures as if they were real', async () => {
    mockEnv.SEFAZ_SOURCE = 'live';
    await expect(fetchSefazBatch({})).rejects.toThrow('not available yet');
    mockEnv.SEFAZ_SOURCE = 'simulated';
  });
});
