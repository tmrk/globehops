import { afterEach, describe, expect, it, vi } from 'vitest';
import raw from './generated/diversion-airports.json';
import { decodeDiversionAirports, loadDiversionAirports } from './diversion.ts';
afterEach(() => vi.unstubAllGlobals());
describe('diversion airport decoding', () => {
  it('decodes the compact real dataset without inventing missing attributes', () => {
    const data = decodeDiversionAirports(raw);
    expect(data.airports.length).toBe(raw.meta.counts.airports);
    expect(data.airports[0]).toMatchObject({ id: raw.airports[0][0], lat: Number(raw.airports[0][2]) / 100 });
    expect(data.meta.limitations).toContain('Potential diversion airports');
    expect(data.airports.find((a) => a.code === 'HNL')).toBeDefined();
  });
  it('rejects malformed metadata, criteria, identity, ordering, surface and runway evidence', () => {
    for (const patch of [
      { format: 2 },
      { meta: null },
      { airports: null },
      { meta: { ...raw.meta, contentHash: 'bad' } },
      { meta: { ...raw.meta, generatedAt: 'bad' } },
      { meta: { ...raw.meta, counts: { ...raw.meta.counts, airports: 0 } } },
      { meta: { ...raw.meta, criteria: { ...raw.meta.criteria, minWidthM: 30 } } },
    ])
      expect(() => decodeDiversionAirports({ ...raw, ...patch })).toThrow();
    for (const [field, value] of [
      [0, -1],
      [1, ''],
      [2, 9001],
      [3, 18001],
      [4, 1999],
      [5, 43],
      [6, 4],
      [4, null],
      [4, Infinity],
    ] as const) {
      const copy = structuredClone(raw);
      copy.airports[0][field] = value as never;
      expect(() => decodeDiversionAirports(copy)).toThrow();
    }
    expect(() =>
      decodeDiversionAirports({
        ...raw,
        airports: [raw.airports[1], raw.airports[0]],
        meta: { ...raw.meta, counts: { ...raw.meta.counts, airports: 2 } },
      }),
    ).toThrow();
  });
  it('loads with an abort signal and rejects bad HTTP/JSON', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => raw });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    expect((await loadDiversionAirports('/data', controller.signal)).airports.length).toBeGreaterThan(1000);
    expect(fetch).toHaveBeenCalledWith('/data', { signal: controller.signal });
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(loadDiversionAirports('/data')).rejects.toThrow(/503/);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(loadDiversionAirports('/data')).rejects.toThrow(/Invalid/);
  });
});
