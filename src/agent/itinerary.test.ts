import { describe, it, expect } from 'vitest';
import {
  validateItineraryDocument,
  encodeItineraryParam,
  decodeItineraryParam,
  documentToLinkState,
  linkStateToDocument,
  type ItineraryDocument,
} from './itinerary.ts';
import { parseLink } from '../state/link.ts';
const doc: ItineraryDocument = {
  version: 1,
  stops: [
    { airport: 'CPH', departure: '2026-11-20T08:15+01:00' },
    { airport: 'LHR', arrival: '2026-11-20T09:05', departure: '2026-11-20T11:00', layoverMinutes: 115 },
    { airport: 'JFK', arrival: '2026-11-20T13:50-05:00' },
  ],
  view: { time: '2026-11-20T09:30Z', play: false, speed: 'auto', clock: 'local', units: 'km', dayNight: true },
};
describe('itinerary document v1', () => {
  it('validates a full document and allows one airport and optional view fields', () => {
    expect(validateItineraryDocument(doc)).toEqual({ ok: true, doc });
    for (const airport of ['CPH', 'EGLL', 'AB123456', '12345'])
      expect(validateItineraryDocument({ version: 1, stops: [{ airport }] }).ok).toBe(true);
    expect(
      validateItineraryDocument({ version: 1, stops: Array.from({ length: 10 }, () => ({ airport: 'CPH' })) }).ok,
    ).toBe(true);
    expect(validateItineraryDocument({ ...doc, view: {} }).ok).toBe(true);
  });
  it.each([
    null,
    [],
    {},
    { ...doc, version: 2 },
    { ...doc, stops: [] },
    { ...doc, stops: Array(11).fill({ airport: 'CPH' }) },
    { ...doc, stops: ['CPH'] },
    { ...doc, stops: [{ airport: 'CP' }] },
    { ...doc, stops: [{ airport: 'C!H' }] },
    { ...doc, stops: [{ airport: 123 }] },
    { ...doc, stops: [{ airport: 'CPH', departure: 'tomorrow' }] },
    { ...doc, stops: [{ airport: 'CPH', departure: '2026-11-20' }] },
    { ...doc, stops: [{ airport: 'CPH', departure: '2026-11-20T12:00:30' }] },
    { ...doc, view: null },
    { ...doc, view: { play: 'true' } },
    { ...doc, view: { dayNight: 1 } },
    { ...doc, view: { units: 'nm' } },
    { ...doc, view: { speed: '3600' } },
    { ...doc, view: { speed: 1 } },
    { ...doc, view: { time: '2026-11-20T12:00' } },
    { ...doc, $schema: 1 },
  ])('rejects structurally invalid input %#', (raw) => {
    const result = validateItineraryDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.every((i) => typeof i.path === 'string' && i.message.length > 0)).toBe(true);
  });
  it.each([-1, 1.5, 10081, '90', null])('rejects invalid layover %s', (layoverMinutes) => {
    expect(
      validateItineraryDocument({
        ...doc,
        stops: [{ airport: 'CPH' }, { airport: 'LHR', layoverMinutes }, { airport: 'JFK' }],
      }).ok,
    ).toBe(false);
  });
  it('allows layover limits but restricts layovers to transfers', () => {
    for (const layoverMinutes of [0, 10080])
      expect(
        validateItineraryDocument({
          ...doc,
          stops: [{ airport: 'CPH' }, { airport: 'LHR', layoverMinutes }, { airport: 'JFK' }],
        }).ok,
      ).toBe(true);
    expect(validateItineraryDocument({ version: 1, stops: [{ airport: 'CPH', layoverMinutes: 90 }] }).ok).toBe(false);
  });
  it('rejects additional properties at every level with JSON-pointer paths', () => {
    const result = validateItineraryDocument({
      ...doc,
      surprise: 1,
      stops: [{ airport: 'CPH', 'a/b~': 1 }],
      view: { unknown: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.path)).toEqual(['/surprise', '/stops/0/a~1b~0', '/view/unknown']);
  });
  it('leaves airport existence and time-zone chronology to the journey pipeline', () => {
    expect(
      validateItineraryDocument({
        version: 1,
        stops: [
          { airport: 'ZZZ', departure: '2026-11-20T12:00Z' },
          { airport: 'JFK', arrival: '2026-11-19T12:00Z' },
        ],
      }).ok,
    ).toBe(true);
  });
  it('round trips base64url UTF-8 JSON including non-ASCII schema strings', () => {
    const unicode = { ...doc, $schema: 'https://example.com/旅程/Æø.json' };
    const encoded = encodeItineraryParam(unicode);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(decodeItineraryParam(encoded)).toEqual({ ok: true, doc: unicode });
  });
  it.each(['', '!', 'a', '====', '____', btoa('{}').replace(/=/g, ''), btoa('not json').replace(/=/g, '')])(
    'rejects malformed encodings/documents: %s',
    (encoded) => {
      expect(decodeItineraryParam(encoded).ok).toBe(false);
    },
  );
  it('converts document ↔ link state without losing local times, explicit offsets or view', () => {
    const state = documentToLinkState(doc);
    expect(state.issues).toEqual([]);
    expect(state.stops?.[0].departure).toEqual({ local: '2026-11-20T08:15', offsetMin: 60 });
    expect(state.view.time).toBe(Date.UTC(2026, 10, 20, 9, 30));
    expect(linkStateToDocument(state)).toEqual(doc);
    expect(documentToLinkState(linkStateToDocument(state))).toEqual(state);
    const link = parseLink(
      '?route=CPH-LHR_180-JFK&dep1=2026-11-20T08:15&arr3=2026-11-20T13:50&speed=7200&clock=JFK&units=mi&daynight=0',
    );
    expect(documentToLinkState(linkStateToDocument(link))).toEqual(link);
  });
  it('reports malformed document offsets instead of silently discarding them', () => {
    const state = documentToLinkState({
      version: 1,
      stops: [
        { airport: 'CPH', departure: '2026-11-20T08:00+99:00' },
        { airport: 'LHR', arrival: '2026-11-20T09:00+00:99' },
      ],
    });
    expect(state.issues).toEqual(['Stop 1: invalid departure time.', 'Stop 2: invalid arrival time.']);
  });
  it('defaults absent views and accepts zero-second input', () => {
    const state = documentToLinkState({
      version: 1,
      stops: [{ airport: 'cph', departure: '2026-11-20T08:00:00Z' }, { airport: 'lhr' }],
    });
    expect(state.stops?.[0].departure).toEqual({ local: '2026-11-20T08:00', offsetMin: 0 });
    expect(state.view).toEqual({ time: null, play: false, speed: 'auto', clock: 'local', units: null, dayNight: true });
  });
  it('rejects oversized inputs before decoding and oversized output gracefully', () => {
    const result = decodeItineraryParam('a'.repeat(6001));
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'too_large' }] });
    expect(() => encodeItineraryParam({ ...doc, $schema: 'x'.repeat(6000) })).toThrow(RangeError);
    expect(() => encodeItineraryParam({ ...doc, version: 2 } as unknown as ItineraryDocument)).toThrow(TypeError);
    expect(validateItineraryDocument({ version: 1, stops: Array(100000).fill({ airport: 'CPH' }) }).ok).toBe(false);
  });
});
