const minimal = { version: 1, stops: [{ airport: 'CPH' }] };
const scheduled = {
  version: 1,
  stops: [
    { airport: 'CPH', departure: '2026-11-20T08:15' },
    { airport: 'LHR', arrival: '2026-11-20T09:05', departure: '2026-11-20T11:00' },
    { airport: 'JFK', arrival: '2026-11-20T13:50' },
  ],
};
/** JSON-serialisable corpus is shared by runtime, published schema and MCP schema tests. */
export const DOCUMENT_CORPUS: unknown[] = [
  minimal,
  {
    version: 1,
    journeys: [{ label: 'Direct', stops: scheduled.stops }, { stops: minimal.stops }],
    view: { clock: 'LHR' },
  },
  { version: 1, journeys: [{ stops: minimal.stops }] },
  ...[0, 5].map((count) => ({ version: 1, journeys: Array(count).fill({ stops: minimal.stops }) })),
  { version: 1, stops: minimal.stops, journeys: [{ stops: minimal.stops }] },
  ...['✈️ via London', '🌍'.repeat(40), '🌍'.repeat(41), '', ' ', 'a\nb', 'a\u007fb', 'x'.repeat(41)].map((label) => ({
    version: 1,
    journeys: [{ label, stops: minimal.stops }],
  })),
  { version: 1, journeys: [{ stops: [{ airport: '!' }] }] },
  { version: 1, journeys: [{ stops: [{ airport: 'CPH', layoverMinutes: 90 }] }] },
  { version: 1, journeys: [{ stops: minimal.stops, extra: 1 }] },
  { version: 1, journeys: [null] },
  { version: 1, journeys: null },

  { ...scheduled, view: { lang: 'hu', names: true, borders: false, follow: true, leg: 2 } },
  ...[{ lang: 'de' }, { names: 1 }, { borders: null }, { leg: 0 }, { leg: 55 }, { leg: 1.5 }].map((view) => ({
    ...scheduled,
    view,
  })),
  scheduled,
  { ...minimal, $schema: 'custom' },
  ...Array.from({ length: 10 }, (_, i) => ({
    version: 1,
    stops: Array.from({ length: i + 1 }, (_, j) => ({
      airport: j % 2 ? 'JFK' : 'CPH',
      ...(j > 0 && j < i ? { layoverMinutes: 0 } : {}),
    })),
  })),
  { version: 1, stops: [{ airport: '123456789' }, { airport: 'AB12' }] },
  {
    ...minimal,
    view: { time: '2026-11-20T10:00:17Z', play: true, speed: 1800, clock: '123456789', units: 'mi', dayNight: false },
  },
  // Structural validation deliberately leaves calendar/offset/airport correctness to semantics.
  { version: 1, stops: [{ airport: 'ZZZ', departure: '2026-99-99T99:99+99:99' }] },
  null,
  [],
  'route',
  {},
  { version: 2, stops: minimal.stops },
  { version: 1, stops: [] },
  { version: 1, stops: Array.from({ length: 11 }, () => ({ airport: 'CPH' })) },
  { ...minimal, extra: 1 },
  { ...minimal, $schema: 1 },
  { version: 1, stops: [null] },
  { version: 1, stops: [{ airport: 'CPH', extra: 1 }] },
  { version: 1, stops: [{ airport: 'AB' }] },
  { version: 1, stops: [{ airport: 'CN-0123' }] },
  { version: 1, stops: [{ airport: 123 }] },
  { version: 1, stops: [{ airport: 'CPH', departure: '2026-11-20' }] },
  { version: 1, stops: [{ airport: 'CPH', departure: '2026-11-20T08:15:01' }] },
  ...[0, 90, null].map((layoverMinutes) => ({ version: 1, stops: [{ airport: 'CPH', layoverMinutes }] })),
  ...[-1, 10081, 1.5, '90'].map((layoverMinutes) => ({
    version: 1,
    stops: [{ airport: 'CPH' }, { airport: 'LHR', layoverMinutes }, { airport: 'JFK' }],
  })),
  ...[
    null,
    [],
    { extra: 1 },
    { time: '2026-11-20T10:00' },
    { play: 1 },
    { speed: '3600' },
    { clock: 'Europe/London' },
    { units: 'nm' },
    { dayNight: 'false' },
  ].map((view) => ({ ...minimal, view })),
];
