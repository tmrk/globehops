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
    { ...doc, view: { follow: 'yes' } },
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
      '?route=CPH-LHR_180-JFK&dep1=2026-11-20T08:15&arr3=2026-11-20T13:50&speed=7200&clock=JFK&units=mi&daynight=0&follow=1',
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
    expect(state.view).toEqual({
      time: null,
      play: false,
      speed: 'auto',
      clock: 'local',
      units: null,
      dayNight: true,
      follow: false,
    });
  });
  it('rejects oversized inputs before decoding and oversized output gracefully', () => {
    const result = decodeItineraryParam('a'.repeat(6001));
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'too_large' }] });
    expect(() => encodeItineraryParam({ ...doc, $schema: 'x'.repeat(6000) })).toThrow(RangeError);
    expect(() => encodeItineraryParam({ ...doc, version: 2 } as unknown as ItineraryDocument)).toThrow(TypeError);
    expect(validateItineraryDocument({ version: 1, stops: Array(100000).fill({ airport: 'CPH' }) }).ok).toBe(false);
  });
});

describe('journeys documents', () => {
  const comparison: ItineraryDocument = {
    version: 1,
    journeys: [
      {
        label: 'BA via London',
        stops: [
          { airport: 'BUD', departure: '2026-12-01T07:10' },
          { airport: 'LHR', layoverMinutes: 180 },
          { airport: 'JFK' },
        ],
      },
      { label: 'Közvetlen & x=y', stops: [{ airport: 'BUD' }, { airport: 'JFK' }] },
    ],
    view: { play: true, clock: 'LHR' },
  };
  it('round-trips UTF-8 documents, links, labels and shared views', () => {
    expect(decodeItineraryParam(encodeItineraryParam(comparison))).toEqual({ ok: true, doc: comparison });
    const state = documentToLinkState(comparison);
    expect(state.label).toBe('BA via London');
    expect(state.compare?.[0].label).toBe('Közvetlen & x=y');
    expect(state.stops?.[1].layoverMin).toBe(180);
    expect(documentToLinkState(linkStateToDocument(state))).toEqual(state);
    expect(parseLink(`?itinerary=${encodeItineraryParam(comparison)}`)).toEqual(state);
  });
  it('requires exactly one form and bounds each journey independently', () => {
    for (const raw of [
      { version: 1 },
      { ...comparison, stops: [{ airport: 'BUD' }] },
      { version: 1, journeys: [] },
      { version: 1, journeys: Array(5).fill({ stops: [{ airport: 'BUD' }] }) },
      { version: 1, journeys: [{ stops: [] }] },
      { version: 1, journeys: [{ stops: Array(11).fill({ airport: 'BUD' }) }] },
    ])
      expect(validateItineraryDocument(raw).ok).toBe(false);
    expect(validateItineraryDocument({ version: 1, journeys: [{ stops: [{ airport: 'BUD' }] }] }).ok).toBe(true);
  });
  it('uses JSON-pointer paths for nested stop, label and layover issues', () => {
    const result = validateItineraryDocument({
      version: 1,
      journeys: [
        { stops: [{ airport: 'BUD' }] },
        { label: 'x'.repeat(41), stops: [{ airport: '!', layoverMinutes: 90 }] },
      ],
    });
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        '/journeys/1/label',
        '/journeys/1/stops/0/airport',
        '/journeys/1/stops/0/layoverMinutes',
      ]),
    );
    for (const label of ['', ' ', 'A\nB', 'x'.repeat(41)])
      expect(validateItineraryDocument({ version: 1, journeys: [{ label, stops: [{ airport: 'BUD' }] }] }).ok).toBe(
        false,
      );
  });
  it('keeps single-journey documents in the classic stops form', () => {
    const state = documentToLinkState({
      version: 1,
      journeys: [{ label: 'A', stops: [{ airport: 'BUD' }, { airport: 'JFK' }] }],
    });
    const document = linkStateToDocument(state);
    expect(document.stops).toHaveLength(2);
    expect(document.journeys).toBeUndefined();
  });
});

const plannedDocTrack: import('./itinerary.ts').TrackDoc = {
  kind: 'planned',
  format: 'document',
  name: 'North Atlantic',
  points: [
    [51, 0, 0],
    [55, -30, 11000],
    [40, -74, 0],
  ],
};
describe('document custom paths', () => {
  const document = (track: unknown) => ({ version: 1, stops: [{ airport: 'LHR', track }, { airport: 'JFK' }] });
  it('validates the shared schema and round-trips readable points with provenance', async () => {
    const { Ajv2020 } = await import('ajv/dist/2020.js');
    const { ITINERARY_SCHEMA } = await import('./schema.ts');
    const validate = new Ajv2020().compile(ITINERARY_SCHEMA);
    const raw = document(plannedDocTrack);
    expect(validate(raw)).toBe(true);
    const checked = validateItineraryDocument(raw);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error('Invalid document');
    const state = documentToLinkState(checked.doc);
    expect(state.stops?.[0].track?.source.name).toBe('North Atlantic');
    expect(linkStateToDocument(state).stops?.[0].track).toEqual(plannedDocTrack);
    const implicit = document({
      points: [
        [0, 0, null, '2026-03-01T10:00:00Z'],
        [0, 1, 1000, '2026-03-01T10:10:00Z'],
      ],
    });
    const parsed = validateItineraryDocument(implicit);
    expect(parsed.ok && documentToLinkState(parsed.doc).stops?.[0].track?.kind).toBe('recorded');
    const { encodeTrack } = await import('../lib/trackCodec.ts');
    const encoded = document({ encoded: encodeTrack(state.stops![0].track!) });
    const checkedEncoded = validateItineraryDocument(encoded);
    expect(checkedEncoded.ok && documentToLinkState(checkedEncoded.doc).stops?.[0].track?.points).toEqual(
      state.stops?.[0].track?.points,
    );
    const backwards = document({
      points: [
        [0, 0, null, '2026-03-01T10:00:00Z'],
        [0, 1, null, '2026-03-01T09:00:00Z'],
      ],
    });
    const normalized = validateItineraryDocument(backwards);
    expect(normalized.ok && documentToLinkState(normalized.doc).stops?.[0].track?.kind).toBe('planned');
  });
  it.each([
    null,
    {},
    { points: [[0, 0]] },
    {
      points: [
        [91, 0],
        [0, 0],
      ],
    },
    {
      points: [
        [0, 181],
        [0, 0],
      ],
    },
    {
      points: [
        [0, 0, 30001],
        [0, 0],
      ],
    },
    {
      points: [
        [0, 0, null, '2026-03-01T10:00'],
        [0, 0],
      ],
    },
    {
      points: [
        [0, 0, null, '2026-02-30T10:00Z'],
        [0, 0],
      ],
    },
    { encoded: 'broken' },
    { ...plannedDocTrack, encoded: 'broken' },
    { ...plannedDocTrack, name: 'bad\nname' },
    { ...plannedDocTrack, name: 'a'.repeat(81) },
    { ...plannedDocTrack, format: 'unknown' },
    { ...plannedDocTrack, kind: 'generated' },
    { ...plannedDocTrack, surprise: true },
  ])('rejects structurally invalid tracks with track paths: %j', (track) => {
    const result = validateItineraryDocument(document(track));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.startsWith('/stops/0/track'))).toBe(true);
  });
  it('rejects tracks on the last stop and arrays beyond the shared limit', () => {
    expect(validateItineraryDocument({ version: 1, stops: [{ airport: 'JFK', track: plannedDocTrack }] }).ok).toBe(
      false,
    );
    expect(validateItineraryDocument(document({ points: Array.from({ length: 20001 }, () => [0, 0]) })).ok).toBe(false);
  });
});
