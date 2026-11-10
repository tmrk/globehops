import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import { computeComparison, type ComparisonInput } from './compare.ts';
import { comparisonGlobeRoute, comparisonSegments, journeyLegOffsets, localLegAt } from './compareView.ts';

const airports: Airport[] = [
  {
    id: 1,
    ident: 'BUD',
    iata: 'BUD',
    icao: null,
    name: 'Budapest',
    city: 'Budapest',
    lat: 47,
    lng: 19,
    country: 'Hungary',
    countryCode: 'HU',
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  },
  {
    id: 2,
    ident: 'LHR',
    iata: 'LHR',
    icao: null,
    name: 'Heathrow',
    city: 'London',
    lat: 51,
    lng: 0,
    country: 'UK',
    countryCode: 'GB',
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  },
  {
    id: 3,
    ident: 'JFK',
    iata: 'JFK',
    icao: null,
    name: 'Kennedy',
    city: 'New York',
    lat: 40,
    lng: -74,
    country: 'US',
    countryCode: 'US',
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  },
];
function input(indices: number[], departure?: string): ComparisonInput {
  return {
    label: null,
    input: {
      id: 'unused',
      stops: indices.map((index, i) => ({
        airport: airports[index],
        zone: 'UTC',
        layoverMin: null,
        arrival: null,
        departure: i === 0 && departure ? { local: departure, offsetMin: null } : null,
      })),
    },
  };
}
const list = () => computeComparison([input([0, 2]), input([0, 1, 2]), input([2, 0])], { assumedStart: null });

describe('comparison globe mapping', () => {
  it('maps global legs through journeys with different leg counts and empty drafts', () => {
    const compared = list();
    compared.splice(1, 0, ...computeComparison([input([])], { assumedStart: null }));
    expect(journeyLegOffsets(compared)).toEqual([0, 1, 1, 3]);
    expect(localLegAt(compared, 2)).toEqual({ index: 2, leg: 1 });
    expect(localLegAt(compared, 3)).toEqual({ index: 3, leg: 0 });
    expect(localLegAt(compared, -1)).toBeNull();
    expect(localLegAt(compared, 4)).toBeNull();
  });
  it('deduplicates shared airports with origin priority and separates journey arcs', () => {
    const route = comparisonGlobeRoute(list(), 1, false, (airport) => airport.city);
    expect(route.markers).toHaveLength(3);
    expect(route.markers.find((marker) => marker.key === '3')?.role).toBe('origin');
    expect(route.legs.map((leg) => [leg.lift, leg.muted])).toEqual([
      [1, true],
      [1.22, false],
      [1.22, false],
      [1.44, true],
    ]);
    expect(route.legs.map((leg) => leg.key)).toEqual(['A:1>3#1', 'B:1>2#1', 'B:2>3#1', 'C:3>1#1']);
    expect(comparisonGlobeRoute(list(), 1, true, (airport) => airport.city).legs.every((leg) => !leg.muted)).toBe(true);
  });
  it('preserves single-journey keys, colour palette and repeated-leg identity', () => {
    const compared = computeComparison([input([0, 1, 0, 1])], { assumedStart: null });
    const route = comparisonGlobeRoute(compared, 0, false, (airport) => airport.city);
    expect(route.legs.map((leg) => leg.key)).toEqual(['1>2#1', '2>1#1', '1>2#2']);
    expect(new Set(route.legs.map((leg) => leg.color)).size).toBe(3);
  });
});

describe('comparison bars', () => {
  it('shows estimated flying and layover durations on one proportional axis', () => {
    const compared = list();
    const direct = comparisonSegments(compared[0], compared);
    const connecting = comparisonSegments(compared[1], compared);
    expect(direct[0].left).toBe(0);
    expect(direct[0].width).toBeLessThan(100);
    expect(connecting.map((segment) => segment.kind)).toEqual(['flight', 'ground', 'flight']);
    expect(connecting.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
    expect(comparisonSegments(computeComparison([input([])], { assumedStart: null })[0], compared)).toEqual([]);
  });
  it('aligns real departures, layovers and arrivals to the scrubber gutters', () => {
    const compared = computeComparison([input([0, 2], '2026-11-20T08:00'), input([0, 1, 2], '2026-11-20T10:00')], {
      assumedStart: null,
    });
    const range = { start: Date.parse('2026-11-20T07:30Z'), end: Date.parse('2026-11-21T07:30Z') };
    const a = comparisonSegments(compared[0], compared, range);
    const b = comparisonSegments(compared[1], compared, range);
    expect(a[0].left).toBeCloseTo(100 / 48);
    expect(b[0].left).toBeCloseTo(500 / 48);
    expect(b[1].kind).toBe('ground');
    expect(b[1].left).toBeCloseTo(b[0].left + b[0].width);
    expect(b[2].left).toBeCloseTo(b[1].left + b[1].width);
  });
});

describe('globe legs along detours', () => {
  it('passes a routed path to the globe and keys the leg by its shape', () => {
    const route = (from: Airport, to: Airport) => ({
      status: 'detour' as const,
      path: [from, { lat: 70, lng: -30 }, to].map(({ lat, lng }) => ({ lat, lng })),
      distanceKm: 9000,
      greatCircleKm: 6000,
      avoided: ['z'],
      crossed: [],
      avoidedPlaces: ['XX'],
      crossedPlaces: [],
    });
    const direct = comparisonGlobeRoute(list().slice(0, 1), 0, false, (a) => a.city);
    const routed = comparisonGlobeRoute(
      computeComparison([input([0, 2])], { assumedStart: null, route }),
      0,
      false,
      (a) => a.city,
    );
    expect(direct.legs[0]).toMatchObject({ key: '1>3#1', path: null });
    expect(routed.legs[0].key).toMatch(/^1>3#1~[0-9a-z]+$/);
    expect(routed.legs[0].path).toHaveLength(3);
  });
});

it('maps exact track paths and altitudes and refreshes keys for geometry or altitude changes', () => {
  const track: import('./track.ts').CustomTrack = {
    kind: 'planned',
    source: { format: 'document', name: null },
    points: [
      { lat: 0, lng: 0, altM: 0, time: null },
      { lat: 0, lng: 1, altM: 11000, time: null },
    ],
  };
  const data = input([0, 2]);
  data.input.stops[0].track = track;
  const compared = computeComparison([data], { assumedStart: null });
  const route = comparisonGlobeRoute(compared, 0, false, (a) => a.city);
  expect(route.legs[0].path).toBe(compared[0].journey.legs[0].track?.path);
  expect(route.legs[0].altitudes).toEqual([0, 11]);
  expect(route.legs[0].key).toContain('~tplanned');
  const changed = { ...track, points: track.points.map((p) => ({ ...p, altM: 1000 })) };
  data.input.stops[0].track = changed;
  expect(
    comparisonGlobeRoute(computeComparison([data], { assumedStart: null }), 0, false, (a) => a.city).legs[0].key,
  ).not.toBe(route.legs[0].key);
});
