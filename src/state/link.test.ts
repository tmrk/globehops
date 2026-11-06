import { describe, it, expect } from 'vitest';
import type { Airport } from '../types.ts';
import { parseLink, serializeLink, buildLinkUrl, type SerializableLinkStop } from './link.ts';
import { encodeItineraryParam } from '../agent/itinerary.ts';
const airports = ['CPH', 'LHR', 'JFK'].map((code, i): Airport => ({
  id: i,
  iata: code,
  icao: null,
  ident: code,
  name: code,
  city: code,
  lat: 0,
  lng: 0,
  country: '',
  countryCode: '',
  region: '',
  type: 'large',
  scheduled: true,
  keywords: [],
}));
const stops: SerializableLinkStop[] = airports.map((airport, i) => ({
  airport,
  layoverMin: i === 1 ? 180 : null,
  departure: null,
  arrival: null,
}));
describe('journey share links', () => {
  it('keeps the legacy route/layover grammar unchanged', () => {
    const query = '?route=CPH-LHR_180-JFK';
    expect(serializeLink(stops, {})).toBe(query);
    expect(parseLink(query).stops?.map((s) => [s.code, s.layoverMin])).toEqual([
      ['CPH', null],
      ['LHR', 180],
      ['JFK', null],
    ]);
    expect(parseLink(query).issues).toEqual([]);
    expect(parseLink('').stops).toBeNull();
    expect(parseLink('?route=').stops).toEqual([]);
    expect(serializeLink([], {})).toBe('');
  });
  it('round trips entered times, offsets and every view setting in canonical order', () => {
    const entered = stops.map((s, i) => ({
      ...s,
      departure: i < 2 ? { local: '2026-11-20T08:15', offsetMin: 60 } : null,
      arrival: i > 0 ? { local: '2026-11-20T09:05', offsetMin: null } : null,
    }));
    const view = {
      time: Date.UTC(2026, 10, 20, 9, 30),
      play: true,
      speed: 3600 as const,
      clock: 'JFK',
      units: 'mi' as const,
      dayNight: false,
      follow: true,
    };
    const query = serializeLink(entered, view);
    expect(query).toBe(
      '?route=CPH-LHR_180-JFK&dep1=2026-11-20T08:15%2B01:00&arr2=2026-11-20T09:05&dep2=2026-11-20T08:15%2B01:00&arr3=2026-11-20T09:05&t=2026-11-20T09:30Z&play=1&speed=3600&clock=JFK&units=mi&daynight=0&follow=1',
    );
    const parsed = parseLink(query);
    expect(parsed.view).toEqual(view);
    expect(parsed.stops).toEqual(
      entered.map((s) => ({
        code: s.airport.iata,
        layoverMin: s.layoverMin,
        departure: s.departure,
        arrival: s.arrival,
      })),
    );
    expect(parsed.issues).toEqual([]);
    expect(new URL(buildLinkUrl('https://example.com/globehops/?old=1#view', entered, view)).search).toBe(query);
  });
  it.each(['%2B', '+', '%20'])('accepts a positive offset encoded as %s', (plus) => {
    const s = parseLink(`?route=CPH-LHR&dep1=2026-11-20T08:15${plus}01:00&t=2026-11-20T08:15${plus}01:00`);
    expect(s.stops?.[0].departure).toEqual({ local: '2026-11-20T08:15', offsetMin: 60 });
    expect(s.view.time).toBe(Date.UTC(2026, 10, 20, 7, 15));
    expect(s.issues).toEqual([]);
  });
  it('accepts case-insensitive parameter names and route codes', () => {
    const s = parseLink('?RoUtE=cph-lhr-jfk&DeP1=2026-11-20T08:15&SpEeD=AUTO&ClOcK=lHr&UnItS=MI&DaYnIgHt=0');
    expect(s.stops?.[0].code).toBe('CPH');
    expect(s.stops?.[0].departure?.local).toBe('2026-11-20T08:15');
    expect(s.view).toMatchObject({ clock: 'LHR', units: 'mi', dayNight: false });
    expect(s.issues).toEqual([]);
  });
  it.each([
    'dep1=bad',
    'dep1=2026-11-20Z',
    'dep1=2026-02-30T12:00',
    'arr2=2026-11-20T12:00%2B24:00',
    't=nope',
    'speed=fast',
    'clock=NYC',
    'units=meters',
    'daynight=maybe',
    'play=yes',
    'follow=yes',
    'dep4=2026-11-20T08:00',
    'arr0=2026-11-20T08:00',
  ])('ignores malformed %s while retaining valid parts', (param) => {
    const s = parseLink(`?route=CPH-LHR&${param}&units=km`);
    expect(s.stops).toHaveLength(2);
    expect(s.issues).toHaveLength(1);
  });
  it('omits endpoint times, defaults and endpoint layovers', () => {
    const allTimes = stops.map((s) => ({
      ...s,
      arrival: { local: '2026-11-20T12:00', offsetMin: null },
      departure: { local: '2026-11-20T12:00', offsetMin: null },
    }));
    const query = serializeLink(allTimes, { speed: 'auto', clock: 'local', dayNight: true });
    expect(query).not.toContain('arr1=');
    expect(query).not.toContain('dep3=');
    expect(query).not.toContain('speed=');
    expect(query).not.toContain('clock=');
    expect(parseLink('?route=CPH-LHR&arr1=2026-11-20T12:00&dep2=2026-11-20T12:00').issues).toHaveLength(2);
  });
  it('retains date-only inputs and normalizes optional zero seconds', () => {
    expect(
      parseLink('?route=CPH-LHR&dep1=2026-11-20&arr2=2026-11-20T09:00:00').stops?.map((s) => [s.departure, s.arrival]),
    ).toEqual([
      [{ local: '2026-11-20', offsetMin: null }, null],
      [null, { local: '2026-11-20T09:00', offsetMin: null }],
    ]);
  });
  it('uses itinerary documents ahead of other route parameters and falls back on invalid ones', () => {
    const doc = {
      version: 1 as const,
      stops: [{ airport: 'JFK' }, { airport: 'LAX' }],
      view: { speed: 1800 as const },
    };
    const encoded = encodeItineraryParam(doc);
    expect(parseLink(`?route=CPH-LHR&itinerary=${encoded}`).stops?.map((s) => s.code)).toEqual(['JFK', 'LAX']);
    const invalid = parseLink('?itinerary=!!!&route=CPH-LHR');
    expect(invalid.stops).toHaveLength(2);
    expect(invalid.issues).toHaveLength(1);
  });
  it('caps stop count and reports malformed route tokens and layovers', () => {
    expect(parseLink(`?route=${Array(11).fill('CPH').join('-')}`).stops).toHaveLength(10);
    expect(parseLink(`?route=${Array(11).fill('CPH').join('-')}`).issues).toHaveLength(1);
    expect(parseLink('?route=CPH-LHR_99999-JFK').issues).toHaveLength(1);
    expect(parseLink('?route=CPH-!-JFK').stops?.map((s) => s.code)).toEqual(['CPH', 'JFK']);
  });
  it('ignores unknown params, handles duplicate names deterministically and rejects oversize inputs', () => {
    expect(parseLink('?route=CPH-LHR&alien=1').issues).toEqual([]);
    expect(parseLink('?route=CPH-LHR&speed=1800&SPEED=7200').view.speed).toBe(1800);
    expect(parseLink(`?route=${'A'.repeat(8001)}`).issues).toHaveLength(1);
    expect(parseLink(`?route=${'A'.repeat(8001)}`).stops).toBeNull();
    expect(() =>
      serializeLink([{ ...stops[0], departure: { local: 'X'.repeat(9000), offsetMin: null } }, stops[1]], {}),
    ).toThrow(RangeError);
    expect(() => buildLinkUrl(`https://example.com/${'x'.repeat(8000)}`, stops)).toThrow(RangeError);
  });
});

it('keeps default links unchanged and round trips the optional aircraft view in both formats', () => {
  expect(parseLink('').view.follow).toBe(false);
  expect(serializeLink(stops, { follow: false })).toBe('?route=CPH-LHR_180-JFK');
  expect(parseLink('?FOLLOW=1').view.follow).toBe(true);
  expect(parseLink('?follow=0').view.follow).toBe(false);
  const encoded = encodeItineraryParam({
    version: 1,
    stops: [{ airport: 'CPH' }, { airport: 'JFK' }],
    view: { follow: true },
  });
  expect(parseLink(`?itinerary=${encoded}`).view.follow).toBe(true);
});

it('round trips language, layers and flight selection in readable and document links', () => {
  const view = { lang: 'hu' as const, names: true, borders: false, leg: 2 };
  const query = serializeLink(stops, view);
  expect(parseLink(query).view).toMatchObject(view);
  const url = new URL(buildLinkUrl('https://example.com/globehops/', stops, view));
  expect(url.pathname).toBe('/globehops/hu/');
  expect(url.searchParams.has('lang')).toBe(false);
  expect(buildLinkUrl('https://example.com/seven/', stops, { lang: 'sv', time: Date.UTC(2026, 10, 20, 10) })).toContain(
    '/seven/sv/?route=CPH-LHR_180-JFK&t=2026-11-20T10:00Z',
  );
  expect(parseLink(url.search, url.pathname).view).toMatchObject(view);
  expect(parseLink('?lang=hu', '/globehops/sv/').view.lang).toBe('sv');
  expect(buildLinkUrl('https://example.com/elsewhere/en/', stops, { lang: 'sv' })).toContain('/elsewhere/sv/');
  const encoded = encodeItineraryParam({
    version: 1,
    stops: [{ airport: 'CPH' }, { airport: 'LHR' }, { airport: 'JFK' }],
    view,
  });
  expect(parseLink(`?itinerary=${encoded}`).view).toMatchObject(view);
  for (const invalid of ['lang=de', 'names=yes', 'borders=2', 'leg=0', 'leg=3', 'leg=1.5'])
    expect(parseLink(`?route=CPH-LHR-JFK&${invalid}`).issues).toHaveLength(1);
  expect(serializeLink(stops, { follow: false, dayNight: true, clock: 'local' }, true)).toContain(
    'clock=local&daynight=1&follow=0',
  );
});

describe('comparison links', () => {
  it('preserves an explicitly empty primary journey when sharing alternatives', () => {
    const query = serializeLink([], {}, false, { compare: [{ label: null, stops }] });
    expect(query).toMatch(/^\?route=&b.route=/);
    expect(parseLink(query).stops).toEqual([]);
    expect(parseLink(query).compare?.[0].stops).toHaveLength(3);
  });
  it('round-trips labels, schedules and all three prefixed groups before view parameters', () => {
    const dated = stops.map((stop, index) => ({
      ...stop,
      departure: index === 0 ? { local: '2026-12-01T07:10', offsetMin: 60 } : null,
      arrival: index === 2 ? { local: '2026-12-01T14:35', offsetMin: -300 } : null,
    }));
    const extra = {
      label: ' BA via London ',
      compare: [
        { label: 'Árvíz & x=y', stops: dated },
        { label: null, stops },
        { label: 'D', stops },
      ],
    };
    const query = serializeLink(dated, { clock: 'JFK', play: true }, false, extra);
    expect(query).toContain('&label=BA%20via%20London&b.route=');
    expect(query).toContain('&b.label=%C3%81rv%C3%ADz%20%26%20x%3Dy&c.route=');
    expect(query.indexOf('&d.label=D')).toBeLessThan(query.indexOf('&play=1'));
    const parsed = parseLink(query);
    expect(parsed.issues).toEqual([]);
    expect(parsed.label).toBe('BA via London');
    expect(parsed.compare).toHaveLength(3);
    expect(parsed.compare?.[0]).toEqual({ label: 'Árvíz & x=y', stops: parsed.stops });
    expect(buildLinkUrl('https://example.com/', dated, { lang: 'hu' }, false, extra)).toContain('/hu/?route=');
    const second = serializeLink(dated, parsed.view, false, {
      label: parsed.label,
      compare: parsed.compare!.map((journey) => ({
        label: journey.label,
        stops: journey.stops.map((stop, index) => ({ ...stop, airport: airports[index] })),
      })),
    });
    expect(parseLink(second)).toEqual(parsed);
  });
  it('parses case-insensitive keys, compacts gaps and accepts a clock airport from another journey', () => {
    const parsed = parseLink(
      '?ROUTE=CPH-JFK&C.ROUTE=CPH-LHR-JFK&C.DEP1=2026-12-01T08:00&C.LABEL=Via%20London&Clock=LHR',
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.compare).toHaveLength(1);
    expect(parsed.compare?.[0].label).toBe('Via London');
    expect(parsed.compare?.[0].stops[0].departure?.local).toBe('2026-12-01T08:00');
    expect(parsed.view.clock).toBe('LHR');
  });
  it('reports missing routes, excess journeys, invalid labels and prefixed time errors', () => {
    expect(parseLink('?route=CPH-JFK&b.label=Missing').issues.join(' ')).toContain('no route');
    expect(
      parseLink('?route=CPH-JFK&b.route=CPH-JFK&c.route=CPH-JFK&d.route=CPH-JFK&e.route=CPH-JFK').issues,
    ).toContain('Only 4 journeys can be compared.');
    for (const label of ['', ' ', 'a\nb', 'a\u007fb', 'x'.repeat(41)]) {
      expect(parseLink(`?route=CPH-JFK&label=${encodeURIComponent(label)}`).issues).toHaveLength(1);
      expect(() => serializeLink(stops, {}, false, { label })).toThrow(TypeError);
    }
    expect(parseLink('?route=CPH-JFK&b.route=CPH-JFK&b.dep5=no').issues[0]).toContain('b.');
    expect(() => serializeLink(stops, {}, false, { compare: Array(4).fill({ label: null, stops }) })).toThrow('Only 4');
  });
  it('enforces the existing sharing limit including comparison groups', () => {
    expect(parseLink(`?route=CPH-JFK&b.label=${'x'.repeat(8000)}`).issues).toEqual(['This link is too long.']);
    expect(() =>
      buildLinkUrl(`https://example.com/${'x'.repeat(7900)}`, stops, {}, false, {
        label: 'a'.repeat(40),
        compare: [{ label: 'b'.repeat(40), stops }],
      }),
    ).toThrow(RangeError);
  });
});
