import { agentImportContext } from '../agent/importRoute.ts';
import { createPlanState, planReducer } from './plan.ts';
import { groupFlights } from '../lib/import/group.ts';
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { decodeDataset } from '../data/airports.ts';
import { decodeTimeZones } from '../data/timezones.ts';
import { createAgentContext, resolveItinerary } from '../agent/plan.ts';
import { computeJourney } from '../lib/schedule.ts';
import type { ClockSnapshot } from './clock.ts';
import { parseLink, type SerializableJourney } from './link.ts';
import { createToolView, createVisitShareLink, toolJourneyResponse, importWebRoute } from './appWebState.ts';

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
    expect(result.comparison?.journeys.map((entry) => ('legs' in entry ? entry.legs.length : 0))).toEqual([2, 1]);
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

it('reports the active alternative and section while retaining the compared trip plan', () => {
  const returnInput = resolveItinerary(context, 'JFK-CPH').input;
  const alternativeReturn = resolveItinerary(context, 'JFK-LHR').input;
  const result = toolJourneyResponse({
    context,
    primaryStops: primary.stops,
    linkExtra: {
      sections: [{ label: null, stops: returnInput.stops, stayMin: null }],
      compare: [{ ...alternative, sections: [{ label: 'Back', stops: alternativeReturn.stops, stayMin: 7200 }] }],
    },
    active: 1,
    activeSection: 1,
    currentView: createToolView(snapshot, true, settings, null),
    snapshot,
    assumedStart: snapshot.time,
    journey: computeJourney(alternativeReturn, { assumedStart: snapshot.time }),
    url: 'https://example.com/trip',
  });
  expect(result.comparison).toMatchObject({
    kind: 'trip_comparison',
    url: result.url,
    journeys: [
      { id: 'A', sections: expect.any(Array) },
      { id: 'B', sections: expect.any(Array) },
    ],
    comparison: { sections: expect.any(Array) },
  });
  expect(result).not.toHaveProperty('trip');
  expect(result.stops.map((stop) => stop.code)).toEqual(['JFK', 'LHR']);
  expect(result.legs).toHaveLength(1);
  expect(result.totals.flights).toBe(1);
  expect(result.valid).toBe(true);
});

it('reports exact flight paths and full point counts without URL simplification or timestamp loss', () => {
  const start = Date.UTC(2026, 2, 1, 10) + 123;
  const track: import('../lib/track.ts').CustomTrack = {
    kind: 'recorded',
    source: { format: 'gpx', name: 'local only' },
    points: Array.from({ length: 20000 }, (_, i) => ({ lat: 0, lng: i / 1000, altM: 10000, time: start + i * 1000 })),
  };
  const stops = primaryInput.stops.slice(0, 2).map((s, i) => ({ ...s, ...(i === 0 ? { track } : {}) }));
  const journey = computeJourney({ id: 'A', stops });
  const view = createToolView(snapshot, true, settings, null);
  const response = toolJourneyResponse({
    context,
    primaryStops: stops,
    linkExtra: {},
    active: 0,
    currentView: view,
    snapshot,
    assumedStart: null,
    journey,
    url: 'https://example.com/',
  });
  expect(response.valid).toBe(true);
  expect(response.legs[0].path).toMatchObject({ kind: 'recorded', points: 20000, source: { name: 'local only' } });
  expect(response.legs[0].durationMinutes).toBe(Math.round(19999 / 60));
});

it('imports into the live callback only after successful parsing and returns the resulting share link', async () => {
  let plan = createPlanState();
  const apply = vi.fn((result: import('../lib/import/types.ts').ImportResult, mode: 'replace' | 'compare') => {
    expect(mode).toBe('replace');
    const { journeys } = groupFlights(result.flights);
    plan = planReducer(plan, {
      type: 'load',
      journeys: journeys.map((flights) => ({
        airportIds: [flights[0].from.id, ...flights.map((flight) => flight.to.id)],
        tracks: flights.map((flight) => flight.track),
      })),
      trip: journeys.length > 1,
    });
  });
  const response = await importWebRoute(
    { type: 'import_route', text: 'EGLL KJFK', mode: 'replace' },
    agentImportContext(context),
    {
      canCompare: () => false,
      apply,
      shareLink: () => `https://example.com/?flights=${plan.journeys[0].route.stops.length - 1}`,
    },
  );
  expect(apply).toHaveBeenCalledOnce();
  expect(response).toMatchObject({
    applied: true,
    format: 'route',
    flights: [{ from: 'LHR', to: 'JFK', kind: 'planned', points: 2 }],
    url: 'https://example.com/?flights=1',
  });
  expect(plan.journeys[0].route.stops[0].track?.track.points).toHaveLength(2);
});

it('never invokes the import callback for failed parsing, an unavailable comparison or an aborted invocation', async () => {
  const apply = vi.fn();
  const target = { apply, canCompare: () => false, shareLink: () => 'https://example.com/' };
  await expect(
    importWebRoute(
      { type: 'import_route', text: 'invalid input', mode: 'replace' },
      agentImportContext(context),
      target,
    ),
  ).rejects.toThrow();
  await expect(
    importWebRoute({ type: 'import_route', text: 'LHR JFK', mode: 'compare' }, agentImportContext(context), target),
  ).rejects.toThrow(/Compare requires/);
  await expect(
    importWebRoute({ type: 'import_route', text: 'LHR JFK\nCDG CPH', mode: 'compare' }, agentImportContext(context), {
      ...target,
      canCompare: () => true,
    }),
  ).rejects.toThrow(/Compare requires/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    importWebRoute(
      { type: 'import_route', text: 'LHR JFK', mode: 'replace' },
      agentImportContext(context),
      target,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(apply).not.toHaveBeenCalled();
  await importWebRoute({ type: 'import_route', text: 'LHR JFK', mode: 'compare' }, agentImportContext(context), {
    ...target,
    canCompare: () => true,
  });
  expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ok: true }), 'compare');
});
