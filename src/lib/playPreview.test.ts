import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import { computeJourney, type JourneyInput } from './schedule.ts';
import { computeTrip } from './trip.ts';
import { comparisonPreview, journeyPreview, STAY_SHARE, tripPreview } from './playPreview.ts';
import { legColor } from './legColors.ts';

const airport = (code: string, lng: number): Airport => ({
  id: 1000 + lng,
  ident: code,
  iata: code,
  icao: null,
  name: code,
  city: code,
  lat: 50,
  lng,
  country: '',
  countryCode: '',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
});
const BUD = airport('BUD', 19);
const LHR = airport('LHR', 0);
const JFK = airport('JFK', -74);
const input = (airports: Airport[], layoverMin: number | null = null): JourneyInput => ({
  id: 'A',
  stops: airports.map((a) => ({ airport: a, zone: 'UTC', layoverMin, arrival: null, departure: null })),
});
const now = Date.UTC(2027, 0, 1);

describe('play preview strip', () => {
  it('lays a journey out in proportion: flights in leg colours, the connection between them', () => {
    const journey = computeJourney(input([BUD, LHR, JFK], 120), { now });
    const [lane] = journeyPreview(journey);
    expect(lane.color).toBeNull();
    expect(lane.segments.map((s) => s.kind)).toEqual(['flight', 'ground', 'flight']);
    expect(lane.segments[0].start).toBe(0);
    expect(lane.segments.at(-1)!.end).toBeCloseTo(1, 9);
    expect(lane.segments.map((s) => s.color)).toEqual([legColor(0), undefined, legColor(1)]);
    // Widths follow the minutes: the ocean crossing is the longest part.
    const width = (i: number) => lane.segments[i].end - lane.segments[i].start;
    const [first, transfer, second] = [0, 1, 2];
    expect(width(second)).toBeGreaterThan(width(first));
    const total = journey.legs[0].estimatedMin! + 120 + journey.legs[1].estimatedMin!;
    expect(width(transfer)).toBeCloseTo(120 / total, 9);
  });

  it('has nothing to show without flights', () => {
    expect(journeyPreview(computeJourney(input([BUD]), { now }))).toEqual([]);
  });

  it('draws a trip on one lane, its stay a short break, its leg colours continuing', () => {
    const trip = computeTrip(
      [
        { label: null, stayMin: null, input: input([BUD, LHR]) },
        { label: null, stayMin: 10080, input: { ...input([LHR, BUD]), id: 'B' } },
      ],
      { assumedStart: null, now },
    );
    const [lane] = tripPreview(trip);
    expect(lane.segments.map((s) => s.color)).toEqual([legColor(0), legColor(1)]);
    // The stay is a fixed break, not seven days of strip.
    expect(lane.segments[1].start - lane.segments[0].end).toBeCloseTo(STAY_SHARE, 9);
    expect(lane.segments[1].end).toBeCloseTo(1, 9);
  });

  it('puts compared journeys on one scale so the quicker one finishes first', () => {
    const nonstop = computeJourney(input([BUD, JFK]), { now });
    const connecting = computeJourney(input([BUD, LHR, JFK]), { now });
    const lanes = comparisonPreview([
      { color: '#ffc24b', journey: nonstop },
      { color: '#5ea8f2', journey: connecting },
    ]);
    expect(lanes.map((lane) => lane.color)).toEqual(['#ffc24b', '#5ea8f2']);
    expect(lanes[1].segments.at(-1)!.end).toBeCloseTo(1, 9);
    expect(lanes[0].segments.at(-1)!.end).toBeLessThan(1);
    expect(lanes[1].segments.every((s) => s.kind === 'ground' || s.color === '#5ea8f2')).toBe(true);
  });

  it('skips compared alternatives that have no flights yet', () => {
    const lanes = comparisonPreview([
      { color: '#ffc24b', journey: computeJourney(input([BUD, JFK]), { now }) },
      { color: '#5ea8f2', journey: computeJourney(input([]), { now }) },
    ]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].segments[0].end).toBeCloseTo(1, 9);
  });
});
