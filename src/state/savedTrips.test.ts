import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_PARAMS, MAX_URL_LENGTH } from '../agent/contract.ts';
import { parseLink } from './link.ts';
import {
  addSavedTrip,
  canonicalTripQuery,
  findSavedTrip,
  loadSavedTrips,
  MAX_SAVED_TRIPS,
  removeSavedTrip,
  restoreSavedTrip,
  SAVED_TRIPS_KEY,
  storeSavedTrips,
  updateSavedTrip,
  type SavedTrip,
} from './savedTrips.ts';

afterEach(() => vi.unstubAllGlobals());
const makeTrip = (id = 'a', query = '?route=CPH-LHR', now = 1): SavedTrip => ({
  id,
  query,
  savedAt: now,
  updatedAt: now,
});
function storage(raw: string | null = null) {
  let value = raw;
  const fake = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
  vi.stubGlobal('localStorage', fake);
  return fake;
}

it('canonicalizes parameter ordering and encoding and keeps only journey content', () => {
  const query =
    '?route=CPH-LHR_180-JFK&dep1=2026-11-15T09:00&label=My%20trip&2.route=JFK-CPH&2.stay=5d&b.route=CPH-JFK&b.2.route=JFK-CPH&b.2.stay=4d';
  const canonical = canonicalTripQuery(query);
  expect(canonicalTripQuery(canonical)).toBe(canonical);
  expect(
    canonicalTripQuery(
      '?' +
        [...new URLSearchParams(query)]
          .reverse()
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&'),
    ),
  ).toBe(canonical);
  expect(canonical).toContain('09:00');
  expect(canonical).toContain('label=My+trip');
  expect(parseLink(canonical)).toEqual(parseLink(query));
  expect(
    canonicalTripQuery(
      query +
        '&t=2026-11-15T09:00Z&play=1&live=1&speed=60&clock=utc&units=mi&daynight=0&follow=1&names=0&borders=0&airspace=0&diversion=0&leg=1&lang=hu&unknown=hello',
    ),
  ).toBe(canonical);
  expect(canonicalTripQuery('?route=&play=1')).toBe('');
  expect(canonicalTripQuery('?2.route=LHR-JFK')).toContain('2.route=LHR-JFK');
  expect(canonicalTripQuery('?route=CPH-LHR&label=' + 'x'.repeat(MAX_URL_LENGTH))).toBe('');
});

it('classifies every link contract parameter so new view options require review', () => {
  const content = ['route', 'label', 'dep', 'arr', 'trk', 'stay', 'itinerary'];
  const view = [
    't',
    'play',
    'live',
    'speed',
    'clock',
    'units',
    'daynight',
    'follow',
    'lang',
    'names',
    'borders',
    'leg',
    'airspace',
    'diversion',
  ];
  expect(Object.values(LINK_PARAMS).sort()).toEqual([...content, ...view].sort());
  for (const key of view) expect(canonicalTripQuery(`?route=CPH-LHR&${key}=1`)).toBe('?route=CPH-LHR');
});

it('adds newest first, deduplicates canonical queries before the cap, and rejects empty plans', () => {
  const a = addSavedTrip([], '?route=CPH-LHR', 10, 'a')!;
  const b = addSavedTrip(a.trips, '?route=LHR-JFK', 20, 'b')!;
  expect(b.trips.map((trip) => trip.id)).toEqual(['b', 'a']);
  const same = addSavedTrip(b.trips, '?play=1&route=CPH-LHR', 30)!;
  expect(same).toMatchObject({ trip: a.trip, added: false });
  expect(findSavedTrip(b.trips, '?route=CPH-LHR&lang=sv')).toBe(a.trip);
  const full = Array.from({ length: MAX_SAVED_TRIPS }, (_, i) => makeTrip(String(i), `?route=CPH-LHR&label=${i}`));
  expect(addSavedTrip(full, '?route=CPH-JFK', 50)).toBeNull();
  expect(addSavedTrip(full, full[0].query, 50)?.added).toBe(false);
  expect(addSavedTrip([], '?route=', 50)).toBeNull();
  const random = addSavedTrip([], '?route=CPH-LHR', 10)!;
  expect(random.trip.id).toHaveLength(8);
  vi.stubGlobal('crypto', undefined);
  expect(addSavedTrip([], '?route=CPH-LHR', 10)!.trip.id).toMatch(/^[a-z0-9]+$/);
});

it('updates content and time, orders by update, and preserves the array for no-ops', () => {
  const trips = [makeTrip('b', '?route=LHR-JFK', 20), makeTrip('a')];
  for (const [id, query] of [
    ['unknown', '?route=JFK-CPH'],
    ['a', '?route='],
    ['a', '?route=CPH-LHR&play=1'],
  ])
    expect(updateSavedTrip(trips, id, query, 30)).toBe(trips);
  const next = updateSavedTrip(trips, 'a', '?route=CPH-JFK', 30);
  expect(next.map((trip) => trip.id)).toEqual(['a', 'b']);
  expect(next[0]).toEqual({ ...trips[1], query: '?route=CPH-JFK', updatedAt: 30 });
  expect(trips[1].query).toBe('?route=CPH-LHR');
});

it('removes and restores at the original index without duplicate ids', () => {
  const trips = ['a', 'b', 'c'].map((id) => makeTrip(id));
  const { trips: next, removed } = removeSavedTrip(trips, 'b');
  expect(removed).toEqual({ trip: trips[1], index: 1 });
  expect(restoreSavedTrip(next, removed!)).toEqual(trips);
  expect(restoreSavedTrip(trips, removed!)).toBe(trips);
  expect(removeSavedTrip(trips, 'missing')).toEqual({ trips, removed: null });
  expect(restoreSavedTrip([], removed!)).toEqual([trips[1]]);
});

describe('best-effort storage', () => {
  it('round trips versioned storage newest first', () => {
    const fake = storage();
    const trips = [makeTrip(), makeTrip('b', '?route=JFK-LAX', 20)];
    expect(storeSavedTrips(trips)).toBe(true);
    expect(fake.setItem).toHaveBeenCalledWith(SAVED_TRIPS_KEY, JSON.stringify({ v: 1, trips }));
    expect(loadSavedTrips()).toEqual([...trips].reverse());
  });
  it('drops malformed documents and entries, duplicates, and oversized queries', () => {
    for (const raw of ['bad', 'null', '[]', '{}', '{"v":2,"trips":[]}', '{"v":1,"trips":{}}']) {
      storage(raw);
      expect(loadSavedTrips()).toEqual([]);
    }
    storage(
      JSON.stringify({
        v: 1,
        trips: [
          null,
          {},
          makeTrip('empty', '?route='),
          makeTrip('long', '?route=CPH-LHR&x=' + 'x'.repeat(MAX_URL_LENGTH)),
          { ...makeTrip('bad'), savedAt: 'today' },
          { ...makeTrip('bad'), updatedAt: -1 },
          makeTrip(),
          makeTrip(),
        ],
      }),
    );
    expect(loadSavedTrips()).toEqual([makeTrip()]);
  });
  it('handles absent, blocked and full storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSavedTrips()).toEqual([]);
    expect(storeSavedTrips([])).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadSavedTrips()).toEqual([]);
    expect(storeSavedTrips([makeTrip()])).toBe(false);
  });
});

it('preserves encoded track payloads in every journey group', async () => {
  const { encodeTrack } = await import('../lib/trackCodec.ts');
  const track = encodeTrack({
    kind: 'planned',
    source: { format: 'document', name: null },
    points: [
      { lat: 0, lng: 0, altM: null, time: null },
      { lat: 1, lng: 1, altM: null, time: null },
    ],
  });
  const params = new URLSearchParams();
  for (const prefix of ['', '2.', 'b.', 'b.2.', 'c.', 'd.6.']) {
    params.set(`${prefix}route`, 'CPH-LHR');
    params.set(`${prefix}trk1`, track);
  }
  const canonical = canonicalTripQuery(`?${params}`);
  const result = new URLSearchParams(canonical);
  for (const prefix of ['', '2.', 'b.', 'b.2.', 'c.', 'd.6.']) expect(result.get(`${prefix}trk1`)).toBe(track);
});

it('expands document links into journey-only queries and handles invalid documents safely', async () => {
  const { encodeItineraryParam } = await import('../agent/itinerary.ts');
  const encoded = encodeItineraryParam({
    version: 1,
    stops: [{ airport: 'JFK' }, { airport: 'LAX' }],
    view: { follow: true, speed: 1800 },
  });
  expect(canonicalTripQuery(`?itinerary=${encoded}`)).toBe('?route=JFK-LAX');
  expect(canonicalTripQuery('?itinerary=!!!')).toBe('');
  expect(canonicalTripQuery('?itinerary=!!!&route=CPH-LHR')).toBe('?route=CPH-LHR');
});
