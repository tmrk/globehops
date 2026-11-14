import { expect, it } from 'vitest';
import { routeCodesText, summarizeSavedTrip } from './savedTripSummary.ts';

it('summarizes a single journey without a dataset', () => {
  expect(summarizeSavedTrip('?route=CPH-LHR-JFK&label=Holiday&dep1=2026-11-14T23:30&arr3=2026-11-15T09:00')).toEqual({
    kind: 'single',
    label: 'Holiday',
    alternatives: [[['CPH', 'LHR', 'JFK']]],
    flights: 2,
    start: '2026-11-14',
    end: '2026-11-15',
  });
  expect(summarizeSavedTrip('?route=CPH-LHR')).toMatchObject({ label: null, start: null, end: null });
  expect(summarizeSavedTrip('')).toEqual({
    kind: 'single',
    label: null,
    alternatives: [[[]]],
    flights: 0,
    start: null,
    end: null,
  });
});

it('preserves alternatives and sections, counting only the first alternative', () => {
  const trip = '?route=BUD-NRT&label=Japan&2.route=NRT-BUD&2.stay=5d&2.dep1=2026-11-20&dep1=2026-11-14T09:00';
  expect(summarizeSavedTrip(trip)).toEqual({
    kind: 'trip',
    label: 'Japan',
    alternatives: [
      [
        ['BUD', 'NRT'],
        ['NRT', 'BUD'],
      ],
    ],
    flights: 2,
    start: '2026-11-14',
    end: '2026-11-20',
  });
  expect(summarizeSavedTrip('?route=BUD-NRT&b.route=BUD-LHR-NRT&b.label=Other&b.dep1=2026-01-01')).toMatchObject({
    kind: 'compare',
    label: null,
    alternatives: [[['BUD', 'NRT']], [['BUD', 'LHR', 'NRT']]],
    flights: 1,
    start: null,
    end: null,
  });
  expect(summarizeSavedTrip(trip + '&b.route=BUD-LHR-NRT&b.2.route=NRT-BUD')).toMatchObject({
    kind: 'compareTrips',
    alternatives: [
      [
        ['BUD', 'NRT'],
        ['NRT', 'BUD'],
      ],
      [
        ['BUD', 'LHR', 'NRT'],
        ['NRT', 'BUD'],
      ],
    ],
    flights: 2,
  });
});

it('uses every stop for a single journey and section ends for trips, joining connected sections', () => {
  expect(routeCodesText([['CPH', 'LHR', 'JFK']])).toBe('CPH → LHR → JFK');
  expect(
    routeCodesText([
      ['BUD', 'HEL', 'NRT'],
      ['NRT', 'BUD'],
    ]),
  ).toBe('BUD → NRT → BUD');
  expect(routeCodesText([['LHR', 'FCO'], [], ['MXP', 'LGW']])).toBe('LHR → FCO · MXP → LGW');
  expect(routeCodesText([[], ['CPH'], ['CPH', 'CPH']])).toBe('CPH → CPH');
  expect(routeCodesText([])).toBe('');
});
