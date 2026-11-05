import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { main, verifyTimeZoneZip } from './build-timezones.ts';
import { extractJsonFromZip } from './lib/zip.ts';
import {
  findCountryOutliers,
  buildTimeZones,
  distanceToEdgeKm,
  lookupTimeZone,
  parseOverrides,
  parseTimeZonePolygons,
  pointInPolygon,
  SENTINELS,
  validateSentinels,
  validateSupportedZones,
} from './lib/timezones.ts';
import { decodeDataset } from '../src/data/airports.ts';
import { decodeTimeZones } from '../src/data/timezones.ts';

/** Tiny real ZIP fixtures, including optional data descriptors and unrelated entries. */
function makeZip(entries: { name: string; text: string; method?: number; descriptor?: boolean }[]): Buffer {
  const locals: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.text),
      name = Buffer.from(entry.name);
    const method = entry.method ?? 8,
      flags = entry.descriptor ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!entry.descriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(entry.descriptor ? 16 : 0);
    if (entry.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(data.length, 12);
    }
    locals.push(local, name, compressed, descriptor);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length + descriptor.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const square = (west = 0, south = 0, east = 1, north = 1) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];
const feature = (zone = 'Etc/UTC', rings = [square()]) => ({
  type: 'Feature',
  properties: { tzid: zone },
  geometry: { type: 'Polygon', coordinates: rings },
});
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
const options = { generatedAt: '2026-11-05T00:00:00.000Z', sentinels: {} };
function airports(points: [number, number, number][] = [[5, 0.5, 0.5]]) {
  return {
    format: 1,
    meta: {
      generatedAt: options.generatedAt,
      source: 'fixture',
      upstreamCommit: null,
      contentHash: 'a'.repeat(64),
      counts: { airports: points.length },
    },
    countries: { GB: 'United Kingdom' },
    regions: {},
    airports: points.map(([id, lat, lng]) => [
      id,
      `TEST${id}`,
      '',
      '',
      'Test airport',
      '',
      'GB',
      '',
      lat,
      lng,
      'S',
      0,
      '',
    ]),
  };
}

describe('ZIP reader', () => {
  it.each([0, 8])('extracts method %s using the central directory', (method) => {
    const zip = makeZip([
      { name: 'notice.txt', text: 'notice' },
      { name: 'combined.json', text: '{"ok":true}', method },
    ]);
    expect(extractJsonFromZip(zip).toString()).toBe('{"ok":true}');
  });
  it('supports data descriptors and a single GeoJSON entry', () => {
    const zip = makeZip([{ name: 'folder/zones.geojson', text: '{"zones":[]}', descriptor: true }]);
    expect(extractJsonFromZip(zip).toString()).toBe('{"zones":[]}');
  });
  it('prefers combined.json and rejects missing or ambiguous JSON entries', () => {
    expect(
      extractJsonFromZip(
        makeZip([
          { name: 'a.json', text: '1' },
          { name: 'combined.json', text: '2' },
        ]),
      ).toString(),
    ).toBe('2');
    expect(() => extractJsonFromZip(makeZip([{ name: 'readme.txt', text: '' }]))).toThrow('single JSON');
    expect(() =>
      extractJsonFromZip(
        makeZip([
          { name: 'a.json', text: '1' },
          { name: 'b.json', text: '2' },
        ]),
      ),
    ).toThrow('single JSON');
  });
  it('rejects truncation, corrupt bytes, ZIP64, encryption and unsupported methods', () => {
    const zip = makeZip([{ name: 'combined.json', text: 'hello', method: 0 }]);
    expect(() => extractJsonFromZip(zip.subarray(0, -1))).toThrow('Invalid ZIP');
    expect(() => extractJsonFromZip(Buffer.alloc(2))).toThrow('Invalid ZIP');
    const damaged = Buffer.from(zip);
    damaged[30 + 'combined.json'.length] ^= 1;
    expect(() => extractJsonFromZip(damaged)).toThrow('CRC-32');
    const zip64 = Buffer.from(zip);
    zip64.writeUInt16LE(0xffff, zip64.length - 12);
    expect(() => extractJsonFromZip(zip64)).toThrow('ZIP64');
    const encrypted = Buffer.from(zip);
    encrypted.writeUInt16LE(1, 6);
    encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    expect(() => extractJsonFromZip(encrypted)).toThrow('encrypted');
    expect(() => extractJsonFromZip(makeZip([{ name: 'a.json', text: '{}', method: 99 }]))).toThrow('compression');
    expect(() => verifyTimeZoneZip(zip)).toThrow('SHA-256 mismatch');
  });
});

describe('time-zone spatial lookup', () => {
  it('ray casts exterior, holes, reversed rings and boundary points', () => {
    const [polygon] = parseTimeZonePolygons(
      collection(feature('Etc/UTC', [square(0, 0, 4, 4), square(1, 1, 3, 3).reverse()])),
    );
    expect(polygon.bounds).toEqual({ minLng: 0, maxLng: 4, minLat: 0, maxLat: 4 });
    expect(pointInPolygon({ lng: 0.5, lat: 0.5 }, polygon)).toBe(true);
    expect(pointInPolygon({ lng: 2, lat: 2 }, polygon)).toBe(false);
    expect(pointInPolygon({ lng: 5, lat: 2 }, polygon)).toBe(false);
    expect(pointInPolygon({ lng: 0, lat: 0 }, polygon)).toBe(true);
    expect(pointInPolygon({ lng: 1, lat: 2 }, polygon)).toBe(true);
  });
  it('indexes MultiPolygons and respects both split sides of the antimeridian', () => {
    const polygons = parseTimeZonePolygons(
      collection({
        type: 'Feature',
        properties: { tzid: 'Pacific/Fiji' },
        geometry: { type: 'MultiPolygon', coordinates: [[square(179, -1, 180, 1)], [square(-180, -1, -179, 1)]] },
      }),
    );
    expect(polygons).toHaveLength(2);
    for (const lng of [179.5, -179.5, 180, -180])
      expect(lookupTimeZone({ lng, lat: 0 }, polygons)?.zone).toBe('Pacific/Fiji');
    expect(lookupTimeZone({ lng: 0, lat: 0 }, polygons)).toBeNull();
    const westOnly = polygons.slice(1);
    expect(lookupTimeZone({ lng: 180, lat: 0 }, westOnly)?.method).toBe('polygon');
    expect(lookupTimeZone({ lng: 179.9, lat: 0 }, westOnly)?.method).toBe('nearest');
  });
  it('chooses and reports overlaps deterministically regardless of source order', () => {
    const a = feature('Europe/London'),
      b = feature('Etc/UTC');
    for (const source of [collection(a, b), collection(b, a)]) {
      expect(lookupTimeZone({ lng: 0.5, lat: 0.5 }, parseTimeZonePolygons(source))).toEqual({
        zone: 'Etc/UTC',
        method: 'polygon',
        candidates: ['Etc/UTC', 'Europe/London'],
        distanceKm: 0,
      });
    }
    expect(buildTimeZones(collection(a, b), airports(), {}, options).report.overlaps).toHaveLength(1);
  });
  it('finds the nearest edge within 30 km, including holes, and rejects more distant points', () => {
    const polygons = parseTimeZonePolygons(collection(feature()));
    const match = lookupTimeZone({ lng: 1.2, lat: 0.5 }, polygons);
    expect(match?.method).toBe('nearest');
    expect(match?.distanceKm).toBeCloseTo(22.238, 2);
    expect(lookupTimeZone({ lng: 1.269, lat: 0.5 }, polygons)?.method).toBe('nearest');
    expect(lookupTimeZone({ lng: 1.271, lat: 0.5 }, polygons)).toBeNull();
    const holes = parseTimeZonePolygons(collection(feature('Etc/UTC', [square(), square(0.4, 0.4, 0.6, 0.6)])));
    expect(lookupTimeZone({ lng: 0.5, lat: 0.5 }, holes)?.method).toBe('nearest');
    expect(distanceToEdgeKm({ lng: 2, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 })).toBeCloseTo(111.195, 2);
    expect(distanceToEdgeKm({ lng: 0, lat: 1 }, { lng: 0, lat: 0 }, { lng: 0, lat: 0 })).toBeCloseTo(111.195, 2);
  });
  it('breaks nearest ties by zone name', () => {
    const polygons = parseTimeZonePolygons(collection(feature('Europe/London'), feature('Etc/UTC')));
    expect(lookupTimeZone({ lng: 1.1, lat: 0.5 }, polygons)?.zone).toBe('Etc/UTC');
  });
  it('rejects malformed source geometries and coordinates', () => {
    const base = feature();
    const bad = [
      null,
      collection(),
      collection({}),
      collection({ ...base, properties: {} }),
      collection({ ...base, geometry: { type: 'Point', coordinates: [0, 0] } }),
      collection(
        feature('Etc/UTC', [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [2, 1],
          ],
        ]),
      ),
      collection(feature('Etc/UTC', [square(0, 0, 181, 1)])),
      collection(feature('Etc/UTC', [square(0, 0, 1, NaN)])),
    ];
    for (const raw of bad) expect(() => parseTimeZonePolygons(raw)).toThrow();
    expect(() => lookupTimeZone({ lat: 91, lng: 0 }, [])).toThrow('coordinates');
  });
});

describe('country plausibility check', () => {
  const airport = (id: number, countryCode: string) => ({ id, ident: `X${id}`, countryCode });
  it('flags an airport whose zone keeps different clocks from the rest of its country', () => {
    const airports = [airport(1, 'KR'), airport(2, 'KR'), airport(3, 'KR'), airport(4, 'VE'), airport(5, 'VE')];
    const zones = new Map([
      [1, 'Asia/Seoul'],
      [2, 'Asia/Seoul'],
      [3, 'Asia/Shanghai'],
      [4, 'America/Caracas'],
      [5, 'Africa/Ndjamena'],
    ]);
    expect(
      findCountryOutliers(airports, zones, { X4: 'Checked.' }).map((o) => [o.ident, o.others, o.reviewed]),
    ).toEqual([
      ['X3', ['Asia/Seoul'], false],
      ['X4', ['Africa/Ndjamena'], true],
      ['X5', ['America/Caracas'], false],
    ]);
  });
  it('accepts multi-zone countries, equivalent zones and single-airport countries', () => {
    const airports = [airport(1, 'US'), airport(2, 'US'), airport(3, 'NO'), airport(4, 'NO'), airport(5, 'XK')];
    const zones = new Map([
      [1, 'America/New_York'],
      [2, 'America/Los_Angeles'],
      [3, 'Europe/Oslo'],
      [4, 'Arctic/Longyearbyen'],
      [5, 'Europe/Belgrade'],
    ]);
    // New York and Los Angeles are each alone in this tiny fixture, so both are reported; real data has many.
    expect(findCountryOutliers(airports, zones).map((o) => o.ident)).toEqual(['X1', 'X2']);
    zones.set(2, 'America/New_York');
    expect(findCountryOutliers(airports, zones)).toEqual([]);
  });
});

describe('committed airport time zones', () => {
  it('have no unexplained country outliers and no excluded airports', async () => {
    const record = JSON.parse(await readFile('data/timezones-build.json', 'utf8')) as {
      report: { countryOutliers: { ident: string; reviewed: boolean }[] };
    };
    const reviewed = JSON.parse(await readFile('data/timezone-reviewed.json', 'utf8')) as Record<string, string>;
    const excluded = JSON.parse(await readFile('data/excluded-airports.json', 'utf8')) as Record<string, string>;
    // A new outlier is usually an upstream airport with wrong coordinates: exclude it, or explain why it is right.
    expect(record.report.countryOutliers.filter((o) => !o.reviewed).map((o) => o.ident)).toEqual([]);
    expect(Object.keys(reviewed).sort()).toEqual(record.report.countryOutliers.map((o) => o.ident).sort());
    const { airports } = decodeDataset(JSON.parse(await readFile('src/data/generated/airports.json', 'utf8')));
    expect(airports.filter((a) => Object.hasOwn(excluded, a.ident))).toEqual([]);
  });
});

describe('time-zone database builder', () => {
  it('encodes sorted IDs and zones deterministically, records nearest and uses overrides last', () => {
    const source = collection(feature());
    const input = airports([
      [50, 0.5, 10],
      [5, 0.5, 0.5],
      [12, 0.5, 1.1],
    ]);
    const overrides = {
      '50': { zone: 'Europe/London', reason: 'Documented camp clock' },
      '12': { zone: 'Europe/London', reason: 'Unused because a nearby polygon takes priority' },
    };
    const { dataset, report } = buildTimeZones(source, input, overrides, options);
    expect(dataset.ids).toEqual([5, 7, 38]);
    expect(dataset.zones).toEqual(['Etc/UTC', 'Europe/London']);
    expect(dataset.zone).toEqual([0, 0, 1]);
    expect(dataset.meta.counts).toEqual({ airports: 3, zones: 2, nearest: 1, overrides: 1 });
    expect(report.nearest[0].id).toBe(12);
    expect(report.overrides[0]).toMatchObject({ id: 50, reason: 'Documented camp clock' });
    expect(report.unusedOverrides).toEqual(['12']);
    expect(buildTimeZones(source, input, overrides, options).dataset).toEqual(dataset);
    expect(decodeTimeZones(dataset).byAirportId.size).toBe(3);
  });
  it('requires 100% coverage, valid metadata, supported zones and matching sentinels', () => {
    const source = collection(feature());
    expect(() => buildTimeZones(source, airports([[1, 50, 50]]), {}, options)).toThrow('overrides required');
    expect(() =>
      buildTimeZones(source, { ...airports(), meta: { ...airports().meta, contentHash: '' } }, {}, options),
    ).toThrow('content hash');
    expect(() => buildTimeZones(collection(feature('Invalid/Zone')), airports(), {}, options)).toThrow('unsupported');
    expect(() => validateSupportedZones(['Invalid/One', 'Invalid/Two'])).toThrow('Invalid/One, Invalid/Two');
    const decoded = decodeDataset(airports());
    decoded.airports[0].iata = 'CPH';
    expect(() => validateSentinels(decoded.airports, new Map([[5, 'Etc/UTC']]), { CPH: SENTINELS.CPH })).toThrow(
      'sentinel CPH',
    );
    expect(() => validateSentinels(decoded.airports, new Map(), { LHR: SENTINELS.LHR })).toThrow('missing');
  });
  it('requires numeric override IDs, supported zones and nonempty reasons', () => {
    for (const raw of [
      null,
      [],
      { abc: {} },
      { '0': { zone: 'Etc/UTC', reason: 'why' } },
      { '1': { zone: 'Etc/UTC', reason: ' ' } },
      { '1': { zone: 'Invalid/Zone', reason: 'why' } },
      { '1': { zone: 'Etc/UTC', reason: 'why', typo: true } },
    ])
      expect(() => parseOverrides(raw)).toThrow();
  });
  it('rejects invalid CLI flags before doing work', async () => {
    await expect(main(['--offline', '--refresh'])).rejects.toThrow('Usage');
    await expect(main(['--typo'])).rejects.toThrow('Usage');
    await expect(main(['source.zip'])).rejects.toThrow('Usage');
  });
  it('refuses a downloaded digest mismatch without replacing committed files', async () => {
    const paths = ['../src/data/generated/timezones.json', '../data/timezones-build.json'].map(
      (path) => new URL(path, import.meta.url),
    );
    const before = await Promise.all(paths.map((path) => readFile(path)));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('wrong source'));
    try {
      await expect(main(['--refresh'])).rejects.toThrow('SHA-256 mismatch');
      expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
    } finally {
      fetcher.mockRestore();
    }
  });
  const cache = new URL('../.cache/timezones/2026f/timezones.geojson.zip', import.meta.url);
  it.skipIf(!existsSync(cache))(
    'rebuilds all real airports offline with stable bytes and complete provenance',
    async () => {
      const outputPath = new URL('../src/data/generated/timezones.json', import.meta.url);
      const buildPath = new URL('../data/timezones-build.json', import.meta.url);
      const before = await readFile(outputPath, 'utf8'),
        buildBefore = await readFile(buildPath, 'utf8');
      const cacheModified = (await stat(cache)).mtimeMs;
      const logger = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await main(['--offline']);
        expect(await readFile(outputPath, 'utf8')).toBe(before);
        expect(await readFile(buildPath, 'utf8')).toBe(buildBefore);
        expect((await stat(cache)).mtimeMs).toBe(cacheModified);
        expect(logger).toHaveBeenCalledWith(expect.stringMatching(/^Time zones: \d+\/\d+ airports.*\d+\.\d+s\.$/));
        expect(gzipSync(before).length).toBeLessThan(30 * 1024);
      } finally {
        logger.mockRestore();
      }
    },
    120_000,
  );
});
