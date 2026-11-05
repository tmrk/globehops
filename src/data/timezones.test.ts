import { afterEach, describe, expect, it, vi } from 'vitest';
import rawTimeZones from './generated/timezones.json';
import rawAirports from './generated/airports.json';
import { decodeDataset } from './airports.ts';
import { decodeTimeZones, loadTimeZones, zoneForAirport } from './timezones.ts';

function fixture() {
  return {
    format: 1,
    meta: {
      source: 'fixture',
      release: '2026f',
      license: 'ODbL-1.0',
      attribution: 'Test attribution',
      generatedAt: '2026-11-05T00:00:00.000Z',
      airportsContentHash: 'a'.repeat(64),
      counts: { airports: 3, zones: 2, nearest: 1, overrides: 0 },
    },
    zones: ['Etc/UTC', 'Europe/London'],
    ids: [2, 3, 1],
    zone: [0, 1, 0],
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('time-zone table', () => {
  it('decodes positive ID deltas and zone dictionary indices', () => {
    const raw = fixture(),
      table = decodeTimeZones(raw);
    expect([...table.byAirportId]).toEqual([
      [2, 'Etc/UTC'],
      [5, 'Europe/London'],
      [6, 'Etc/UTC'],
    ]);
    expect(table.meta).toEqual(raw.meta);
    expect(table.zones).toEqual(raw.zones);
    expect(zoneForAirport(table, { id: 5 })).toBe('Europe/London');
    expect(zoneForAirport(null, { id: 5 })).toBeNull();
    expect(zoneForAirport(table, { id: 99999 })).toBeNull();
  });
  it('accepts an older airport content hash so refreshing airports cannot disable route editing', () => {
    const raw = fixture();
    raw.meta.airportsContentHash = 'b'.repeat(64);
    const table = decodeTimeZones(raw);
    expect(zoneForAirport(table, { id: 5 })).toBe('Europe/London');
    expect(zoneForAirport(table, { id: Number.MAX_SAFE_INTEGER })).toBeNull();
  });
  it('rejects malformed format, metadata, counts, names, deltas and indices', () => {
    const changes: ((raw: ReturnType<typeof fixture>) => unknown)[] = [
      () => null,
      () => [],
      (raw) => ({ ...raw, format: 2 }),
      (raw) => ({ ...raw, meta: null }),
      (raw) => ({ ...raw, ids: {} }),
      (raw) => ({ ...raw, zones: null }),
      (raw) => {
        raw.meta.generatedAt = 'yesterday';
        return raw;
      },
      (raw) => {
        raw.meta.source = '';
        return raw;
      },
      (raw) => {
        raw.meta.airportsContentHash = 'oops';
        return raw;
      },
      (raw) => {
        raw.meta.counts.airports = 2;
        return raw;
      },
      (raw) => {
        raw.meta.counts.nearest = 4;
        return raw;
      },
      (raw) => {
        raw.meta.counts.overrides = -1;
        return raw;
      },
      (raw) => {
        raw.zone.pop();
        return raw;
      },
      (raw) => {
        raw.zones.reverse();
        return raw;
      },
      (raw) => {
        raw.zones[1] = raw.zones[0];
        return raw;
      },
      (raw) => {
        raw.zones[0] = '';
        return raw;
      },
      (raw) => {
        raw.zones[0] = '+01:00';
        return raw;
      },
      (raw) => {
        raw.ids[0] = 0;
        return raw;
      },
      (raw) => {
        raw.ids[1] = -1;
        return raw;
      },
      (raw) => {
        raw.ids[1] = 0.5;
        return raw;
      },
      (raw) => {
        raw.ids[1] = NaN;
        return raw;
      },
      (raw) => {
        raw.ids[0] = Number.MAX_SAFE_INTEGER;
        return raw;
      },
      (raw) => {
        raw.zone[0] = -1;
        return raw;
      },
      (raw) => {
        raw.zone[0] = 2;
        return raw;
      },
      (raw) => {
        raw.zone[0] = 0.5;
        return raw;
      },
      (raw) => {
        raw.zone = [0, 0, 0];
        return raw;
      },
    ];
    for (const change of changes) expect(() => decodeTimeZones(change(fixture()))).toThrow();
  });
  it('loads with an AbortSignal and rejects HTTP errors or invalid JSON data', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture())));
    vi.stubGlobal('fetch', fetcher);
    expect((await loadTimeZones('/zones.json', controller.signal)).byAirportId.size).toBe(3);
    expect(fetcher).toHaveBeenCalledWith('/zones.json', { signal: controller.signal });
    fetcher.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(loadTimeZones('/zones.json')).rejects.toThrow('HTTP 503');
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(loadTimeZones('/zones.json')).rejects.toThrow('format');
    fetcher.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(loadTimeZones('/zones.json', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('decodes the committed dataset and covers every committed airport with Intl-supported zones', () => {
    const table = decodeTimeZones(rawTimeZones),
      airports = decodeDataset(rawAirports);
    expect(table.byAirportId.size).toBe(airports.airports.length);
    expect(table.meta.airportsContentHash).toBe(rawAirports.meta.contentHash);
    for (const airport of airports.airports) expect(zoneForAirport(table, airport)).toBeTypeOf('string');
    for (const zone of table.zones) expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow();
  });
  it('matches every geographic sentinel without canonicalising away TBB zone names', () => {
    const table = decodeTimeZones(rawTimeZones),
      { airports } = decodeDataset(rawAirports);
    const expected = {
      CPH: 'Europe/Copenhagen',
      LHR: 'Europe/London',
      JFK: 'America/New_York',
      LAX: 'America/Los_Angeles',
      PHX: 'America/Phoenix',
      IND: 'America/Indiana/Indianapolis',
      DEN: 'America/Denver',
      ORD: 'America/Chicago',
      ANC: 'America/Anchorage',
      HNL: 'Pacific/Honolulu',
      YYZ: 'America/Toronto',
      MEX: 'America/Mexico_City',
      CUN: 'America/Cancun',
      GRU: 'America/Sao_Paulo',
      SYD: 'Australia/Sydney',
      BNE: 'Australia/Brisbane',
      ADL: 'Australia/Adelaide',
      PER: 'Australia/Perth',
      AKL: 'Pacific/Auckland',
      NRT: 'Asia/Tokyo',
      DEL: 'Asia/Kolkata',
      KTM: 'Asia/Kathmandu',
      DXB: 'Asia/Dubai',
      SIN: 'Asia/Singapore',
      HKG: 'Asia/Hong_Kong',
      PEK: 'Asia/Shanghai',
      IST: 'Europe/Istanbul',
      SVO: 'Europe/Moscow',
      VVO: 'Asia/Vladivostok',
      KEF: 'Atlantic/Reykjavik',
    };
    for (const [iata, zone] of Object.entries(expected)) {
      const airport = airports.find((airport) => airport.iata === iata);
      expect(airport, iata).toBeDefined();
      expect(zoneForAirport(table, airport!), iata).toBe(zone);
    }
  });
});
