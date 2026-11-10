import { describe, expect, it } from 'vitest';
import type { Airport, LocalTimeInput } from '../types.ts';
import type { JourneyStopInput } from './schedule.ts';
import type { TripSectionInput } from './trip.ts';
import {
  compareTripMetrics,
  computeTripComparison,
  tripComparisonSkips,
  tripComparisonTimeline,
  type TripComparisonInput,
} from './compareTrips.ts';
import { tripComparisonGlobeRoute } from './tripView.ts';
import { simFrameAt } from '../state/simulation.ts';

const fixtures: Record<string, [number, number, number, string]> = {
  BUD: [1, 47.4369, 19.2556, 'Europe/Budapest'],
  FRA: [2, 50.0333, 8.5706, 'Europe/Berlin'],
  JFK: [3, 40.6398, -73.7789, 'America/New_York'],
};
const airport = (code: string): Airport => {
  const [id, lat, lng] = fixtures[code];
  return {
    id,
    ident: code,
    iata: code,
    icao: null,
    name: code,
    city: code,
    lat,
    lng,
    country: '',
    countryCode: '',
    region: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  };
};
const at = (local: string): LocalTimeInput => ({ local, offsetMin: null });
const stop = (code: string, values: Partial<JourneyStopInput> = {}): JourneyStopInput => ({
  airport: airport(code),
  zone: fixtures[code][3],
  layoverMin: null,
  arrival: null,
  departure: null,
  ...values,
});
const section = (stops: JourneyStopInput[], stayMin: number | null = null): TripSectionInput => ({
  label: null,
  stayMin,
  input: { id: 'x', stops },
});
const option = (label: string, sections: TripSectionInput[]): TripComparisonInput => ({ label, sections });
const NOW = Date.UTC(2026, 10, 10);
const DAY = 86_400_000;

// Via Frankfurt, timed both ways; nonstop, untimed.
const viaFrankfurt = option('Via Frankfurt', [
  section([stop('BUD', { departure: at('2026-12-01T07:10') }), stop('FRA'), stop('JFK')]),
  section([stop('JFK', { departure: at('2026-12-10T18:00') }), stop('FRA'), stop('BUD')]),
]);
const nonstop = (stayMin: number | null = null) =>
  option('Nonstop', [section([stop('BUD'), stop('JFK')]), section([stop('JFK'), stop('BUD')], stayMin)]);

describe('compared trips', () => {
  it('keeps entered times and lines an untimed trip up with the timed one, journey by journey', () => {
    const [a, b] = computeTripComparison([viaFrankfurt, nonstop()], { assumedStart: null, now: NOW });
    expect(a.anchor).toBe('entered');
    expect(a.trip.sections[0].journey.start?.local).toBe('2026-12-01T07:10');
    expect(b.anchor).toBe('assumed');
    expect(b.trip.sections[0].journey.start?.epochMs).toBe(a.trip.sections[0].journey.start?.epochMs);
    // The way back leaves with A's, not a default week after landing.
    expect(b.trip.sections[1].journey.start?.epochMs).toBe(a.trip.sections[1].journey.start?.epochMs);
    expect(b.trip.sections[1].anchor).toBe('assumed');
    expect(b.trip.stays[0].source).toBe('setting');
    expect(a.trip.sections[1].journey.id).toBe('A2');
    expect(b.trip.sections[1].journey.id).toBe('B2');
  });

  it('keeps a stay the traveller chose instead of lining up', () => {
    const [, b] = computeTripComparison([viaFrankfurt, nonstop(3 * 1440)], { assumedStart: null, now: NOW });
    const out = b.trip.sections[0].journey;
    expect(b.trip.sections[1].journey.start?.epochMs).toBe(out.end!.epochMs + 3 * DAY);
  });

  it('starts every untimed trip at the assumed start, each following its own stays', () => {
    const start = Date.UTC(2026, 11, 1, 8);
    const list = computeTripComparison([nonstop(), nonstop(2 * 1440)], { assumedStart: start, now: NOW });
    expect(list.map((entry) => entry.trip.start?.epochMs)).toEqual([start, start]);
    expect(list[0].trip.stays[0].minutes).toBe(7 * 1440);
    expect(list[1].trip.stays[0].minutes).toBe(2 * 1440);
    expect(computeTripComparison([nonstop()], { assumedStart: null, now: NOW })[0].anchor).toBe('none');
  });

  it('ranks complete trips by time travelling, overall and journey by journey', () => {
    const list = computeTripComparison([viaFrankfurt, nonstop()], { assumedStart: null, now: NOW });
    const metrics = compareTripMetrics(list);
    const [a, b] = metrics.trips;
    expect(a.complete && b.complete).toBe(true);
    expect(a.travelMin).toBe(a.sections[0].journeyMin! + a.sections[1].journeyMin!);
    expect(metrics.fastest).toBe('B');
    expect(metrics.deltaMin.A).toBe(a.travelMin - b.travelMin);
    expect(metrics.sections.map((s) => s.fastest)).toEqual(['B', 'B']);
    expect(b.estimated).toBe(true);
  });

  it('leaves an incomplete trip out of the ranking', () => {
    const missingReturn = option('Open', [section([stop('BUD'), stop('JFK')]), section([])]);
    const metrics = compareTripMetrics(
      computeTripComparison([viaFrankfurt, missingReturn], { assumedStart: null, now: NOW }),
    );
    expect(metrics.trips[1].complete).toBe(false);
    expect(metrics.fastest).toBeNull();
  });

  it('shares one clock and skips only the stays every traveller shares', () => {
    const list = computeTripComparison([viaFrankfurt, nonstop()], { assumedStart: null, now: NOW });
    const timeline = tripComparisonTimeline(list)!;
    expect(timeline.start).toBe(list[0].trip.start!.epochMs);
    expect(timeline.end).toBe(Math.max(list[0].trip.end!.epochMs, list[1].trip.end!.epochMs));
    expect(timeline.gaps).toHaveLength(1);
    const [gap] = timeline.gaps;
    // From the later outbound landing to the earliest return departure.
    expect(gap.start).toBe(
      Math.max(list[0].trip.sections[0].journey.end!.epochMs, list[1].trip.sections[0].journey.end!.epochMs),
    );
    expect(gap.end).toBe(list[0].trip.sections[1].journey.start!.epochMs);
    const [skip] = tripComparisonSkips(timeline);
    expect(skip.from).toBeGreaterThan(gap.start);
    expect(skip.to).toBeLessThan(gap.end);
    expect(tripComparisonTimeline(computeTripComparison([nonstop()], { assumedStart: null, now: NOW }))).toBeNull();
  });
});

describe('compared trips on the globe and in the fleet', () => {
  const list = computeTripComparison([viaFrankfurt, nonstop()], { assumedStart: null, now: NOW });

  it('draws every journey of each trip in its colour, keeping compared journeys’ keys for the way out', () => {
    const route = tripComparisonGlobeRoute(list, 1, false, (airport) => airport.city ?? '');
    expect(route.legs.map((leg) => leg.key.replace(/#.*/, ''))).toEqual([
      'A:1>2',
      'A:2>3',
      'A:S1:3>2',
      'A:S1:2>1',
      'B:1>3',
      'B:S1:3>1',
    ]);
    expect(new Set(route.legs.slice(0, 4).map((leg) => leg.color))).toEqual(new Set([list[0].color]));
    // The trip being edited is bright; the way back flies a little above the way out.
    expect(route.legs.map((leg) => leg.muted)).toEqual([true, true, true, true, false, false]);
    expect(route.legs[2].lift!).toBeGreaterThan(route.legs[1].lift!);
    expect(route.legs[4].lift!).toBeGreaterThan(route.legs[0].lift!);
    expect(route.markers).toHaveLength(3);
  });

  it('flies one aircraft per trip on the flattened legs', () => {
    const b = list[1].trip;
    const offset = list[0].trip.totals.flights;
    const fleet = list.map((entry, o) => ({
      journey: entry.trip.sections[0].journey,
      timeline: null,
      trip: { trip: entry.trip, timeline: entry.trip.timeline },
      legOffset: o ? offset : 0,
      color: entry.color,
      tag: entry.id,
    }));
    const homeward = b.sections[1].journey.legs[0];
    const time = (homeward.departure!.epochMs + homeward.arrival!.epochMs) / 2;
    const frame = simFrameAt(b.sections[0].journey, null, time, false, fleet, 1);
    expect(frame.fleet).toHaveLength(2);
    expect(frame.aircraft).toMatchObject({ kind: 'air', leg: offset + b.sections[1].legOffset });
    expect(frame.highlightLeg).toBe(offset + 1);
    // Lined up with A's way back, both travellers fly home together, each on its own legs.
    expect(frame.fleet?.[0].view).toMatchObject({ kind: 'air', leg: list[0].trip.sections[1].legOffset });
  });
});
