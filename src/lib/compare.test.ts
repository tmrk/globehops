import { describe, expect, it } from 'vitest';
import type { Airport } from '../types.ts';
import type { ComparisonInput } from './compare.ts';
import { compareMetrics, comparisonRange, computeComparison, JOURNEY_COLORS, journeyColor } from './compare.ts';

const airport = (code: string, lng: number): Airport => ({
  id: lng,
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
const start = Date.UTC(2026, 10, 20, 8);
function input(departure?: string, arrival?: string, via = false): ComparisonInput {
  return {
    label: null,
    input: {
      id: 'ignored',
      stops: [airport('BUD', 19), ...(via ? [airport('LHR', 0)] : []), airport('JFK', -74)].map(
        (airport, index, all) => ({
          airport,
          zone: 'UTC',
          layoverMin: null,
          arrival: index === all.length - 1 && arrival ? { local: arrival, offsetMin: null } : null,
          departure: index === 0 && departure ? { local: departure, offsetMin: null } : null,
        }),
      ),
    },
  };
}
const compute = (inputs: ComparisonInput[], assumedStart: number | null = null) =>
  computeComparison(inputs, { assumedStart, now: Date.UTC(2027, 0, 1) });
describe('comparison schedules', () => {
  it('preserves absolute entered times and aligns undated journeys to the earliest dated departure', () => {
    const inputs = [input('2026-11-20T10:00'), input(), input('2026-11-20T08:00')];
    const list = compute(inputs, start - 86400000);
    expect(list.map((entry) => entry.journey.start?.epochMs)).toEqual([start + 7200000, start, start]);
    expect(list.map((entry) => entry.anchor)).toEqual(['entered', 'assumed', 'entered']);
    expect(list.map((entry) => entry.id)).toEqual(['A', 'B', 'C']);
    expect(list[1].timeline?.journeyId).toBe('B');
    expect(inputs[0].input.id).toBe('ignored');
  });
  it('back-propagates a dated arrival before aligning alternatives', () => {
    const list = compute([input(undefined, '2026-11-20T20:00'), input()]);
    expect(list[1].journey.start?.epochMs).toBe(list[0].journey.start?.epochMs);
    expect(list[0].anchor).toBe('entered');
  });
  it('uses the supplied assumption only for undated journeys, or leaves timelines absent', () => {
    const dated = compute([input(), input(undefined, undefined, true)], start);
    expect(dated.every((entry) => entry.anchor === 'assumed' && entry.timeline?.start === start)).toBe(true);
    const undated = compute([input(), input()]);
    expect(undated.every((entry) => entry.anchor === 'none' && entry.timeline === null)).toBe(true);
    expect(comparisonRange(undated)).toBeNull();
    expect(comparisonRange(dated)).toEqual({ start, end: Math.max(...dated.map((entry) => entry.timeline!.end)) });
    expect(comparisonRange([])).toBeNull();
  });
  it('compares elapsed duration independently of first arrival and records provenance', () => {
    const list = compute([
      input('2026-11-20T08:00', '2026-11-20T18:00'),
      input('2026-11-20T12:00', '2026-11-20T21:00'),
    ]);
    const metrics = compareMetrics(list);
    expect(metrics.fastest).toBe('B');
    expect(metrics.firstArrival).toBe('A');
    expect(metrics.deltaMin).toEqual({ A: 60, B: 0, C: 0, D: 0 });
    expect(metrics.journeys[0]).toMatchObject({
      journeyMin: 600,
      flightMin: 600,
      layoverMin: 0,
      flights: 1,
      transfers: 0,
      estimated: false,
    });
    expect(
      compareMetrics(compute([input(), input(undefined, undefined, true)])).journeys.every((entry) => entry.estimated),
    ).toBe(true);
  });
  it('returns no winner for ties, fewer than two comparable journeys, or incomplete arrival comparisons', () => {
    const tied = compareMetrics(compute([input(), input()], start));
    expect(tied.fastest).toBeNull();
    expect(tied.firstArrival).toBeNull();
    expect(compareMetrics(compute([input()])).fastest).toBeNull();
    expect(compareMetrics(compute([input(), input(undefined, undefined, true)])).firstArrival).toBeNull();
    expect(compareMetrics([]).fastest).toBeNull();
  });
  it('retains empty and invalid journeys but excludes them from winners and does not assume invalid times', () => {
    const empty: ComparisonInput = { label: 'Empty', input: { id: 'x', stops: [] } };
    const list = compute([empty, input('2026-11-20T12:00', '2026-11-20T08:00'), input('bad'), input()], start);
    expect(list).toHaveLength(4);
    expect(list[0].timeline).toBeNull();
    expect(list[1].timeline).toBeNull();
    expect(list[2].anchor).toBe('none');
    expect(compareMetrics(list).fastest).toBeNull();
    expect(compareMetrics(list).firstArrival).toBeNull();
    expect(compute([input(), input(), input(), input(), input()])).toHaveLength(4);
    expect(journeyColor(5)).toBe(JOURNEY_COLORS[1]);
  });
});
