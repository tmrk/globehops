import { expect, it } from 'vitest';
import { decodeDataset } from '../data/airports.ts';
import raw from '../data/generated/airports.json';
import { computeTrip } from './trip.ts';
import { computeTripComparison } from './compareTrips.ts';
import { tripGlobeRoute, tripComparisonGlobeRoute } from './tripView.ts';
import type { CustomTrack } from './track.ts';
const airports = decodeDataset(raw).airports.slice(0, 2);
const track: CustomTrack = {
  kind: 'planned',
  source: { format: 'document', name: null },
  points: [
    { lat: 0, lng: 0, altM: 0, time: null },
    { lat: 0, lng: 5, altM: 10000, time: null },
  ],
};
const section = (path: CustomTrack | null) => ({
  label: null,
  stayMin: null,
  input: {
    id: 'x',
    stops: airports.map((airport, i) => ({
      airport,
      zone: 'UTC',
      layoverMin: null,
      arrival: null,
      departure: null,
      ...(i === 0 ? { track: path } : {}),
    })),
  },
});
it('uses track paths, altitude arrays and independent keys in trips and compared trips', () => {
  const trip = computeTrip([section(track), section(null)], { assumedStart: 0 });
  const route = tripGlobeRoute(trip, 0, false, (a) => a.city);
  expect(route.legs[0].path).toBe(trip.sections[0].journey.legs[0].track?.path);
  expect(route.legs[0].altitudes).toEqual([0, 10]);
  expect(route.legs[1].path).toBeNull();
  expect(route.legs[1].key).not.toContain('~t');
  const comparisons = computeTripComparison(
    [
      { label: null, sections: [section(track), section(null)] },
      { label: null, sections: [section(null), section(track)] },
    ],
    { assumedStart: 0 },
  );
  const compared = tripComparisonGlobeRoute(comparisons, 0, false, (a) => a.city);
  expect(compared.legs.filter((l) => l.altitudes)).toHaveLength(2);
  expect(compared.legs[0].key).toContain('~tplanned');
  expect(compared.legs[3].key).toContain('~tplanned');
  const changed = { ...track, points: track.points.map((p) => ({ ...p, lng: p.lng + 0.00001 })) };
  const replaced = tripGlobeRoute(
    computeTrip([section(changed), section(null)], { assumedStart: 0 }),
    0,
    false,
    (a) => a.city,
  );
  expect(replaced.legs[0].key).not.toBe(route.legs[0].key);
});
