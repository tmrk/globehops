import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { useJourneyModel } from './useJourneyModel.ts';
import { createPlanState, planReducer } from '../state/plan.ts';
import { decodeDataset } from '../data/airports.ts';
import raw from '../data/generated/airports.json';
import type { CustomTrack } from '../lib/track.ts';
it('passes the exact track object into links, schedule inputs and editor legs', () => {
  const dataset = decodeDataset(raw),
    airports = dataset.airports.slice(0, 2);
  const track: CustomTrack = {
    kind: 'recorded',
    source: { format: 'gpx', name: null },
    points: [
      { lat: 0, lng: 0, altM: 0, time: Date.UTC(2026, 2, 1) },
      { lat: 0, lng: 5, altM: 10000, time: Date.UTC(2026, 2, 1, 1) },
    ],
  };
  const plan = planReducer(createPlanState(), {
    type: 'load',
    journeys: [{ airportIds: airports.map((a) => a.id), tracks: [track] }],
  });
  let model: ReturnType<typeof useJourneyModel> | undefined;
  function Probe() {
    model = useJourneyModel(plan, { dataset, zones: null, lookup: (id) => dataset.byId.get(id) }, true, null);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  expect(model!.primaryStops[0].track).toBe(track);
  expect(model!.journey.stops[0].track).toBe(track);
  expect(model!.legs[0].track).toBe(model!.journey.legs[0].track);
  expect(model!.legs[0].distanceKm).toBe(model!.journey.legs[0].distanceKm);
  expect(model!.legs[0].durationMin).toBe(60);
  expect(model!.timeline).not.toBeNull();
});
