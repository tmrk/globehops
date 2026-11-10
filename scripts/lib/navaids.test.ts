import { describe, expect, it } from 'vitest';
import { buildNavaids } from './navaids.ts';
import { decodeNavaids } from '../../src/data/navaids.ts';
const header = 'id,ident,type,latitude_deg,longitude_deg,iso_country';
const rows = [
  '1,CPT,VOR,51.492184,-1.219584,GB',
  '2,CPT,NDB,-20.0123456,30.0123456,ZA',
  '3,SFO,VOR-DME,37.619,-122.375,US',
  '4,ABC,VORTAC,1,2,GB',
  '5,DEF,TACAN,1,2,GB',
  '6,GHI,NDB-DME,1,2,GB',
  '7,JKL,DME,1,2,GB',
];
const build = (text: string) => buildNavaids(text, { minRows: 0, minSelected: 0, generatedAt: '2026-11-10T00:00:00Z' });
describe('OurAirports navaid build', () => {
  it('keeps all seven allowed types, rounds coordinates and records source hashes/row counts', () => {
    const source = [header, ...rows].join('\n');
    const { dataset, report } = build(source);
    const data = decodeNavaids(dataset);
    expect(data.navaids).toHaveLength(7);
    expect(data.byIdent.get('CPT')?.find((n) => n.type === 'NDB')).toMatchObject({ lat: -20.01235, lng: 30.01235 });
    expect(report.files['navaids.csv']).toMatchObject({
      rows: 7,
      bytes: Buffer.byteLength(source),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(report.counts).toEqual({ VOR: 1, 'VOR-DME': 1, VORTAC: 1, TACAN: 1, NDB: 1, 'NDB-DME': 1, DME: 1 });
  });
  it('drops unknown types, invalid coordinates/idents/countries and duplicate evidence', () => {
    const text = [
      header,
      ...rows,
      '8,INV,VOR,,1,GB',
      '9,INVALID!,NDB,2,3,GB',
      '10,LAT,VOR,91,2,GB',
      '11,X,OTHER,1,2,GB',
      '12,CPT,VOR,51.492184,-1.219584,GB',
      '13,X,VOR,1,2,',
    ].join('\n');
    const { dataset, report } = build(text);
    expect(dataset.navaids).toHaveLength(7);
    expect(report.dropped).toBe(6);
  });
  it('keeps content hashes stable across row ordering and build dates', () => {
    const a = build([header, ...rows].join('\n'));
    const b = buildNavaids([header, ...rows.toReversed()].join('\n'), {
      minRows: 0,
      minSelected: 0,
      generatedAt: '2027-01-01T00:00:00Z',
    });
    expect(a.dataset.meta.contentHash).toBe(b.dataset.meta.contentHash);
    expect(a.dataset.meta.files['navaids.csv'].sha256).not.toBe(b.dataset.meta.files['navaids.csv'].sha256);
  });
  it.each([['id,ident\n1,CPT'], [header + '\n1,CPT'], [header + '\n1,CPT,VOR,1,2,GB\n1,ABC,VOR,2,3,GB']])(
    'rejects malformed/duplicate input',
    (text) => expect(() => build(text)).toThrow(),
  );
  it('guards production against truncated downloads', () =>
    expect(() => buildNavaids([header, ...rows].join('\n'))).toThrow('Truncated'));
});

it('uses country as a deterministic final sorting tie-breaker', () => {
  const rows = ['1,CPT,VOR,1,2,GB', '2,CPT,VOR,1,2,FR'];
  expect(build([header, ...rows].join('\n')).dataset.meta.contentHash).toBe(
    build([header, ...rows.toReversed()].join('\n')).dataset.meta.contentHash,
  );
});
