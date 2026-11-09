/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDataset } from '../data/airports.ts';
import { decodeTimeZones } from '../data/timezones.ts';
import { createAgentContext, resolveItinerary } from '../agent/plan.ts';
import { computeJourney } from '../lib/schedule.ts';
import type { ClockSnapshot } from './clock.ts';
import { parseLink, type SerializableJourney } from './link.ts';
import { createToolView, createVisitShareLink, toolJourneyResponse } from './appWebState.ts';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/generated/${name}.json`, import.meta.url), 'utf8'));
const context = createAgentContext({
  airports: decodeDataset(read('airports')),
  timezones: decodeTimeZones(read('timezones')),
  now: () => Date.UTC(2026, 0, 1),
});
const snapshot: ClockSnapshot = {
  time: Date.UTC(2026, 10, 20, 9, 30),
  playing: false,
  speed: 3600,
  live: false,
  start: null,
  end: null,
  skipping: null,
};
const settings = { clock: 'local', units: 'km' as const, dayNight: true, follow: false, lang: 'hu' as const };
const primaryInput = resolveItinerary(context, 'CPH-LHR-JFK').input;
const alternativeInput = resolveItinerary(context, 'LHR-JFK').input;
const primary: SerializableJourney = { label: null, stops: primaryInput.stops };
const alternative: SerializableJourney = { label: 'Direct', stops: alternativeInput.stops };

describe('live browser-tool state', () => {
  it('keeps live time out of a closed view and makes selected flights one-based', () => {
    expect(createToolView(snapshot, false, settings, null)).toEqual({
      time: null,
      play: false,
      speed: 3600,
      ...settings,
    });
    expect(createToolView(snapshot, true, settings, 1)).toEqual({
      time: snapshot.time,
      play: false,
      speed: 3600,
      ...settings,
      leg: 2,
    });
  });

  it('preserves the exact visit link format with primary selection and alternative journeys', () => {
    const view = createToolView(snapshot, true, settings, 0);
    const url = createVisitShareLink('https://example.com', '/globehops/', 'hu', primary.stops, view, 1, {
      compare: [alternative],
    });
    expect(url).toBe(
      'https://example.com/globehops/hu/?route=CPH-LHR-JFK&b.route=LHR-JFK&b.label=Direct&t=2026-11-20T09:30Z&speed=3600&clock=local&units=km&daynight=1&follow=0&leg=2',
    );
    expect(parseLink(new URL(url).search).view.leg).toBe(2);
  });

  it('marks empty share links explicitly so recipients cannot restore a remembered route', () => {
    const url = createVisitShareLink(
      'https://example.com',
      '/globehops/',
      'en',
      [],
      createToolView(snapshot, false, settings, null),
      null,
      { compare: [] },
    );
    expect(new URL(url).searchParams.has('route')).toBe(true);
    expect(parseLink(new URL(url).search).stops).toEqual([]);
  });

  it('reports the active alternative while keeping the entire comparison and the live clock in the response', () => {
    const view = createToolView(snapshot, true, settings, 0);
    const result = toolJourneyResponse({
      context,
      primaryStops: primary.stops,
      linkExtra: { compare: [alternative] },
      active: 1,
      currentView: view,
      snapshot,
      assumedStart: snapshot.time,
      journey: computeJourney(alternativeInput, { assumedStart: snapshot.time }),
      url: 'https://example.com/visit',
    });
    expect(Object.keys(result)).toEqual([
      'comparison',
      'contractVersion',
      'stops',
      'legs',
      'transfers',
      'totals',
      'issues',
      'valid',
      'view',
      'url',
    ]);
    expect(result.valid).toBe(true);
    expect(result.stops.map((stop) => stop.code)).toEqual(['LHR', 'JFK']);
    expect(result.legs).toHaveLength(1);
    expect(result.comparison?.journeys.map((entry) => entry.id)).toEqual(['A', 'B']);
    expect(result.comparison?.journeys.map((entry) => entry.legs.length)).toEqual([2, 1]);
    expect(result.view).toEqual({ ...view, time: '2026-11-20T09:30:00.000Z', live: false, leg: 1 });
    expect(result.url).toBe('https://example.com/visit');
    expect(result.comparison?.url).toBe(result.url);
  });

  it('leaves undated itineraries undated with the timeline closed', () => {
    const result = toolJourneyResponse({
      context,
      primaryStops: primary.stops,
      linkExtra: { compare: [] },
      active: 0,
      currentView: createToolView(snapshot, false, settings, null),
      snapshot,
      assumedStart: null,
      journey: computeJourney(primaryInput),
      url: 'https://example.com/visit',
    });
    expect(result).not.toHaveProperty('comparison');
    expect(result.legs.every((leg) => leg.departure === null && leg.arrival === null)).toBe(true);
    expect(result.view.leg).toBeNull();
    expect(result.view.time).toBe('2026-11-20T09:30:00.000Z');
  });
});
