import { describe, expect, it } from 'vitest';
import { buildDiversionAirports, normaliseSurface, type DiversionInputs } from './diversion.ts';
const headers = {
  'airports.csv': ['id', 'ident', 'type', 'latitude_deg', 'longitude_deg', 'iata_code', 'icao_code', 'gps_code'],
  'runways.csv': ['id', 'airport_ref', 'airport_ident', 'length_ft', 'width_ft', 'surface', 'lighted', 'closed'],
};
const csv = (rows: string[][]) => rows.map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\n');
const build = (airports: string[][], runways: string[][]) =>
  buildDiversionAirports(
    {
      'airports.csv': csv([headers['airports.csv'], ...airports]),
      'runways.csv': csv([headers['runways.csv'], ...runways]),
    },
    { generatedAt: '2026-11-09T00:00:00.000Z', validation: { minAirports: 0, minRunways: 0, minSelected: 0 } },
  );
const airport = (id: string, type = 'medium_airport', code = 'AAA') => [
  id,
  `TEST${id}`,
  type,
  '10',
  '179.999',
  code,
  'TEST',
  'GPS',
];
const runway = (
  id: string,
  airportId = '1',
  surface = 'ASPH',
  length = '7000',
  width = '148',
  closed = '0',
  lighted = '0',
) => [id, airportId, `TEST${airportId}`, length, width, surface, lighted, closed];
describe('potential diversion airport build', () => {
  it('normalises surfaces conservatively, preserving unknowns and rejecting mixtures with unpaved material', () => {
    for (const s of ['ASP', 'ASPH', 'ASPHALT', 'ASPH-G', 'ASPH-F', 'ASPH-P', 'ASPH-E'])
      expect(normaliseSurface(s)).toBe('asphalt');
    for (const s of ['CON', 'CONC', 'CONCRETE', 'CONC-G']) expect(normaliseSurface(s)).toBe('concrete');
    for (const s of ['PEM', 'PAVED', 'ASPH/ CONC', 'ASPHALT/CONCRETE', 'ASPH-CONC-G', 'ASPH-G/CONC-F'])
      expect(normaliseSurface(s)).toBe('paved');
    expect(normaliseSurface('BIT')).toBe('bitumen');
    for (const s of [
      'TURF',
      'GRS',
      'GRASS',
      'GRE',
      'GVL',
      'GRAVEL',
      'GRVL',
      'DIRT',
      'EARTH',
      'WATER',
      'SAND',
      'CORAL',
      'MATS',
      'SNOW',
      'ICE',
      'ASPH-TURF',
      'CONC/GRAVEL',
    ])
      expect(normaliseSurface(s)).toBe('unpaved');
    for (const s of ['', 'UNK', 'G', 'C', 'B', 'ASPH?', 'invented']) expect(normaliseSurface(s)).toBe('unknown');
  });
  it('uses the longest qualifying runway, accepts imperial width rounding and does not require lighting', () => {
    const { dataset, report } = build(
      [airport('2', 'large_airport', 'BBB'), airport('1')],
      [
        runway('3', '1', 'CONC', '9000', '147'),
        runway('1'),
        runway('2', '2', 'BIT', '6562', '148'),
        runway('4', '1', 'ASPH', '12000', '100'),
      ],
    );
    expect(dataset.airports.map((a) => a[0])).toEqual([1, 2]);
    expect(dataset.airports[0]).toEqual([1, 'AAA', 1000, 18000, 2743, 45, 1]);
    expect(dataset.airports[1][4]).toBe(2000);
    expect(report.counts.unlighted).toBe(2);
    expect(report.counts.excludedWidth).toBe(1);
    expect(report.surfaceMapping.CONC).toEqual({ surface: 'concrete', count: 1 });
  });
  it('counts closed, uncertain, short, narrow and unpaved evidence separately', () => {
    const { dataset, report } = build(
      [airport('1')],
      [
        runway('1', '1', 'UNK'),
        runway('2', '1', 'ASPH', '7000', ''),
        runway('3', '1', 'TURF'),
        runway('4', '1', 'ASPH', '6500'),
        runway('5', '1', 'ASPH', '7000', '140'),
        runway('6', '1', 'ASPH', '7000', '148', '1'),
        runway('7', '1', 'ASPH', '7000', '-1'),
      ],
    );
    expect(dataset.airports).toEqual([]);
    expect(report.counts).toMatchObject({
      excludedUncertain: 3,
      excludedUnpaved: 1,
      excludedLength: 1,
      excludedWidth: 1,
      excludedClosed: 1,
      excludedNoRunway: 1,
    });
  });
  it('filters airport types, never invents coordinates/codes, and retains a GPS/ident fallback', () => {
    const types = ['closed', 'small_airport', 'heliport', 'seaplane_base', 'balloonport'];
    const a = airport('1');
    a[5] = '';
    a[6] = '';
    a[7] = '';
    const { dataset, report } = build([a, ...types.map((t, i) => airport(String(i + 2), t))], [runway('1')]);
    expect(dataset.airports[0][1]).toBe('TEST1');
    expect(report.counts.excludedType).toBe(5);
    const broken = airport('1');
    broken[3] = '';
    expect(build([broken], [runway('1')]).report.counts.excludedPosition).toBe(1);
  });
  it('is deterministic across input order and chooses stable runway ties', () => {
    const airports = [airport('1'), airport('2', 'large_airport', 'BBB')];
    const runways = [runway('1', '1', 'ASPH'), runway('2', '1', 'CONC'), runway('3', '2', 'BIT')];
    const a = build(airports, runways).dataset;
    const b = build(airports.reverse(), runways.reverse()).dataset;
    expect(a.airports).toEqual(b.airports);
    expect(a.meta.contentHash).toBe(b.meta.contentHash);
  });
  it('rejects malformed CSV, duplicate identities, non-numeric dimensions and truncated production inputs', () => {
    expect(() => build([airport('1'), airport('1')], [])).toThrow(/duplicate/);
    expect(() => build([airport('1')], [runway('1'), runway('1')])).toThrow(/duplicate/);
    expect(() => build([airport('1')], [runway('1', '1', 'ASPH', 'oops')])).toThrow(/dimension/);
    expect(() => build([airport('1')], [runway('1', '1', 'ASPH', '7000', '148', 'maybe')])).toThrow(/flags/);
    expect(() =>
      buildDiversionAirports({ 'airports.csv': 'id\n1', 'runways.csv': 'id\n1' } as DiversionInputs),
    ).toThrow(/columns/);
    expect(() =>
      buildDiversionAirports({
        'airports.csv': csv([headers['airports.csv'], airport('1')]),
        'runways.csv': csv([headers['runways.csv'], runway('1')]),
      }),
    ).toThrow(/Truncated/);
  });
});
