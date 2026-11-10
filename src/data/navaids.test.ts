import { describe, expect, it, vi } from 'vitest';
import { decodeNavaids, loadNavaids } from './navaids.ts';
import generated from './generated/navaids.json';
const tiny = () => ({
  format: 1,
  meta: {
    source: 'OurAirports — public domain',
    generatedAt: '2026-11-10T00:00:00Z',
    files: { 'navaids.csv': { sha256: 'a'.repeat(64), bytes: 200, rows: 2 } },
    counts: { VOR: 1, 'VOR-DME': 0, VORTAC: 0, TACAN: 0, NDB: 1, 'NDB-DME': 0, DME: 0 },
    contentHash: 'b'.repeat(64),
  },
  navaids: [
    ['CPT', 'V', 51.49218, -1.21958, 'GB'],
    ['CPT', 'N', -20, 30, 'ZA'],
  ],
});
describe('radio-navaid dataset', () => {
  it('strictly decodes compact type codes and preserves duplicate identifiers in the index', () => {
    const data = decodeNavaids(tiny());
    expect(data.navaids[0]).toEqual({ ident: 'CPT', type: 'VOR', lat: 51.49218, lng: -1.21958, country: 'GB' });
    expect(data.byIdent.get('CPT')).toHaveLength(2);
    expect(data.byIdent.get('cpt')).toBeUndefined();
  });
  it.each([
    (d: ReturnType<typeof tiny>) => {
      d.format = 2;
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[0][1] = 'X';
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[0][2] = 91;
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[0][3] = NaN;
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[0][0] = 'bad ident';
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[0][4] = 'ZZZ';
    },
    (d: ReturnType<typeof tiny>) => {
      d.meta.counts.VOR = 2;
    },
    (d: ReturnType<typeof tiny>) => {
      d.meta.contentHash = 'bad';
    },
    (d: ReturnType<typeof tiny>) => {
      d.meta.files['navaids.csv'].rows = 1;
    },
    (d: ReturnType<typeof tiny>) => {
      d.navaids[1] = [...d.navaids[0]];
    },
  ])('rejects malformed metadata, coordinates or tuples (%#)', (mutate) => {
    const data = tiny();
    mutate(data);
    expect(() => decodeNavaids(data)).toThrow();
  });
  it('decodes the generated public-domain database with more than 5,000 aids', () => {
    const data = decodeNavaids(generated);
    expect(data.navaids.length).toBeGreaterThan(5000);
    expect(data.byIdent.get('CPT')?.some((n) => n.country === 'GB')).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(generated)).length).toBeLessThan(600000);
  });
  it('loads and decodes a supplied URL, reporting HTTP failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tiny())))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    try {
      expect((await loadNavaids('/navaids.json')).navaids).toHaveLength(2);
      await expect(loadNavaids('/bad')).rejects.toThrow('404');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
