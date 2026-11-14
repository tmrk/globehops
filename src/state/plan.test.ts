import { describe, expect, it } from 'vitest';
import { planKind, planReducer, planShape, createPlanState } from './plan.ts';
import { routeReducer } from './route.ts';

describe('plan editor', () => {
  it('starts with one empty journey and delegates route actions to the active journey', () => {
    const state = createPlanState();
    expect(state.active).toBe(0);
    expect(state.journeys[0].route.stops.map((stop) => stop.airportId)).toEqual([null, null]);
    const action = { type: 'setAirport', index: 0, airportId: 12 } as const;
    const expected = routeReducer(state.journeys[0].route, action);
    const next = planReducer(state, { type: 'route', action });
    expect(next.journeys[0].route).toEqual(expected);
    expect(next.journeys[0].key).toBe(state.journeys[0].key);
    expect(planReducer(next, { type: 'route', action })).toBe(next);
  });
  it('adds an empty journey, activates it, and stops at four', () => {
    let state = planReducer(createPlanState(), {
      type: 'load',
      journeys: [
        {
          airportIds: [1, null, 2, 3],
          label: ' A ',
          layovers: [null, null, 180],
          departures: [{ local: '2026-11-20T08:00', offsetMin: null }],
        },
      ],
    });
    state = planReducer(state, { type: 'add' });
    expect(state.active).toBe(1);
    expect(state.journeys[1].route.stops.map((stop) => stop.airportId)).toEqual([null, null]);
    expect(
      state.journeys[1].route.stops.every(
        (stop) => stop.arrival === null && stop.departure === null && stop.layoverMin === null,
      ),
    ).toBe(true);
    expect(state.journeys[1].label).toBeNull();
    expect(new Set(state.journeys.map((journey) => journey.key)).size).toBe(2);
    state = planReducer(planReducer(state, { type: 'add' }), { type: 'add' });
    expect(planReducer(state, { type: 'add' })).toBe(state);
    expect(
      planReducer(createPlanState(), { type: 'add' }).journeys[1].route.stops.map((stop) => stop.airportId),
    ).toEqual([null, null]);
  });
  it('preserves active identity when removing before/after it and selects the previous journey when removed', () => {
    const loaded = planReducer(createPlanState(), {
      type: 'load',
      journeys: [1, 2, 3, 4].map((id) => ({ airportIds: [id, 10] })),
    });
    const state = planReducer(loaded, { type: 'activate', index: 2 });
    const before = planReducer(state, { type: 'remove', index: 0 });
    expect(before.active).toBe(1);
    expect(before.journeys[before.active]).toBe(state.journeys[2]);
    expect(planReducer(state, { type: 'remove', index: 3 }).active).toBe(2);
    expect(planReducer(state, { type: 'remove', index: 2 }).active).toBe(1);
    const single = createPlanState();
    expect(planReducer(single, { type: 'remove', index: 0 })).toBe(single);
  });
  it('normalizes labels and retains identity for no-ops and invalid indices', () => {
    const state = createPlanState();
    const named = planReducer(state, { type: 'setLabel', index: 0, label: '  Direct  ' });
    expect(named.journeys[0].label).toBe('Direct');
    expect(planReducer(named, { type: 'setLabel', index: 0, label: ' Direct ' })).toBe(named);
    expect(planReducer(named, { type: 'setLabel', index: 0, label: 'x'.repeat(50) }).journeys[0].label).toHaveLength(
      40,
    );
    expect(planReducer(state, { type: 'setLabel', index: 0, label: ' ' })).toBe(state);
    expect(planReducer(state, { type: 'activate', index: 0 })).toBe(state);
    for (const index of [-1, 9, 0.5, NaN]) {
      expect(planReducer(state, { type: 'activate', index })).toBe(state);
      expect(planReducer(state, { type: 'remove', index })).toBe(state);
      expect(planReducer(state, { type: 'setLabel', index, label: 'a' })).toBe(state);
      expect(planReducer(state, { type: 'route', index, action: { type: 'reverse' } })).toBe(state);
    }
  });
  it('loads up to four journeys, normalizes an empty load and allows indexed edits', () => {
    const state = planReducer(createPlanState(), {
      type: 'load',
      journeys: [1, 2, 3, 4, 5].map((id) => ({ airportIds: [id, 10] })),
    });
    expect(state.journeys).toHaveLength(4);
    const next = planReducer(state, {
      type: 'route',
      index: 2,
      action: { type: 'setAirport', index: 0, airportId: 30 },
    });
    expect(next.active).toBe(0);
    expect(next.journeys[0]).toBe(state.journeys[0]);
    expect(next.journeys[2].route.stops[0].airportId).toBe(30);
    expect(planReducer(state, { type: 'load', journeys: [] }).journeys).toHaveLength(1);
    const empty = createPlanState();
    expect(planReducer(empty, { type: 'load', journeys: [], continued: true })).toBe(empty);
  });

  describe('trips', () => {
    const roundTrip = () =>
      planReducer(
        planReducer(createPlanState(), {
          type: 'load',
          journeys: [{ airportIds: [1, 2, 3], departures: [{ local: '2026-11-15T07:00', offsetMin: null }] }],
        }),
        { type: 'addReturn' },
      );
    it('adds a return from the destination to the origin, editable, as the active tab', () => {
      const state = roundTrip();
      expect(state.trip).toBe(true);
      expect(planKind(state)).toBe('trip');
      expect(state.active).toBe(1);
      expect(state.journeys[1].route.stops.map((stop) => stop.airportId)).toEqual([3, 1]);
      expect(state.journeys[1].route.stops.every((stop) => !stop.arrival && !stop.departure)).toBe(true);
      // Connections are not copied: the way home is the traveller's choice.
      expect(state.journeys[0].route.stops.map((stop) => stop.airportId)).toEqual([1, 2, 3]);
      expect(planReducer(state, { type: 'addReturn' })).toBe(state);
      // A journey needs two different ends before it can have a return.
      const empty = createPlanState();
      expect(planReducer(empty, { type: 'addReturn' })).toBe(empty);
    });
    it('adds onward journeys from the last destination, up to six, and sets stays and names', () => {
      let state = roundTrip();
      state = planReducer(state, { type: 'addSection' });
      expect(state.active).toBe(2);
      expect(state.journeys[2].route.stops.map((stop) => stop.airportId)).toEqual([1, null]);
      while (state.journeys.length < 6) state = planReducer(state, { type: 'addSection' });
      expect(planReducer(state, { type: 'addSection' })).toBe(state);
      const stayed = planReducer(state, { type: 'setStay', index: 1, minutes: 3 * 1440 });
      expect(stayed.journeys[1].stayMin).toBe(3 * 1440);
      expect(planReducer(stayed, { type: 'setStay', index: 1, minutes: 3 * 1440 })).toBe(stayed);
      expect(planReducer(stayed, { type: 'setStay', index: 1, minutes: 7 * 1440 }).journeys[1].stayMin).toBeNull();
      expect(planReducer(stayed, { type: 'setStay', index: 0, minutes: 1440 })).toBe(stayed);
      const named = planReducer(stayed, { type: 'setLabel', index: 1, label: ' Home ' });
      expect(named.journeys[1].label).toBe('Home');
    });
    it('becomes a single journey again when only one remains, and drops the leading stay', () => {
      let state = planReducer(roundTrip(), { type: 'setStay', index: 1, minutes: 1440 });
      state = planReducer(state, { type: 'remove', index: 0 });
      expect(state.trip).toBe(false);
      expect(planKind(state)).toBe('single');
      expect(state.journeys[0].stayMin).toBeNull();
      expect(state.journeys[0].route.stops.map((stop) => stop.airportId)).toEqual([3, 1]);
    });
    it('loads trips with stays, distinct from comparisons, and keeps identity when unchanged', () => {
      const journeys = [{ airportIds: [1, 3] }, { airportIds: [3, 1], stayMin: 5 * 1440, label: 'Home' }];
      const trip = planReducer(createPlanState(), { type: 'load', journeys, trip: true });
      expect(trip).toMatchObject({ trip: true, active: 0 });
      expect(trip.journeys[1]).toMatchObject({ stayMin: 5 * 1440, label: 'Home' });
      expect(planReducer(trip, { type: 'load', journeys, trip: true, continued: true })).toBe(trip);
      const compared = planReducer(trip, { type: 'load', journeys });
      expect(compared.trip).toBe(false);
      expect(planKind(compared)).toBe('compare');
      expect(planReducer(createPlanState(), { type: 'load', journeys: [journeys[0]], trip: true }).trip).toBe(false);
      const many = planReducer(createPlanState(), {
        type: 'load',
        journeys: Array.from({ length: 8 }, () => journeys[0]),
        trip: true,
      });
      expect(many.journeys).toHaveLength(6);
    });
  });

  describe('compared trips', () => {
    const ids = (state: ReturnType<typeof createPlanState>) =>
      state.journeys.map((journey) => journey.route.stops.map((stop) => stop.airportId));
    const comparing = () =>
      planReducer(createPlanState(), {
        type: 'load',
        journeys: [{ airportIds: [1, 2, 3], label: 'Via 2' }, { airportIds: [1, 3] }, { airportIds: [] }],
      });
    it('gives every compared journey its own way home, as alternative trips', () => {
      const state = planReducer(planReducer(comparing(), { type: 'activate', index: 1 }), { type: 'addReturn' });
      expect(planKind(state)).toBe('compareTrips');
      expect(planShape(state)).toEqual({ sections: 2, options: 3, option: 1, section: 1 });
      expect(ids(state)).toEqual([
        [1, 2, 3],
        [3, 1],
        [1, 3],
        [3, 1],
        [null, null],
        [null, null],
      ]);
      expect(state.journeys[0].label).toBe('Via 2');
      expect(planReducer(state, { type: 'addReturn' })).toBe(state);
      expect(planReducer(state, { type: 'addSection' })).toBe(state);
      expect(planReducer(state, { type: 'remove', index: 0 })).toBe(state);
    });
    it('compares a trip with another, empty, trip of the same journeys, up to four', () => {
      let state = planReducer(createPlanState(), {
        type: 'load',
        journeys: [{ airportIds: [1, 3] }, { airportIds: [3, 1] }],
        trip: true,
      });
      expect(planKind(state)).toBe('trip');
      state = planReducer(state, { type: 'add' });
      expect(planKind(state)).toBe('compareTrips');
      expect(planShape(state)).toEqual({ sections: 2, options: 2, option: 1, section: 0 });
      expect(ids(state).slice(2)).toEqual([
        [null, null],
        [null, null],
      ]);
      state = planReducer(planReducer(state, { type: 'add' }), { type: 'add' });
      expect(planShape(state).options).toBe(4);
      expect(planReducer(state, { type: 'add' })).toBe(state);
    });
    it('sets stays per alternative and removes alternatives or a journey from every alternative', () => {
      let state = planReducer(planReducer(comparing(), { type: 'addReturn' }), { type: 'activate', index: 3 });
      expect(planReducer(state, { type: 'setStay', index: 2, minutes: 1440 })).toBe(state);
      state = planReducer(state, { type: 'setStay', index: 3, minutes: 3 * 1440 });
      expect(state.journeys[3].stayMin).toBe(3 * 1440);
      const fewer = planReducer(state, { type: 'removeOption', option: 0 });
      expect(planShape(fewer)).toEqual({ sections: 2, options: 2, option: 0, section: 1 });
      expect(ids(fewer)[0]).toEqual([1, 3]);
      const lone = planReducer(fewer, { type: 'removeOption', option: 1 });
      expect(planKind(lone)).toBe('trip');
      const oneWay = planReducer(state, { type: 'removeSection', section: 1 });
      expect(planKind(oneWay)).toBe('compare');
      expect(planShape(oneWay)).toEqual({ sections: 1, options: 3, option: 1, section: 0 });
      expect(ids(oneWay)).toEqual([
        [1, 2, 3],
        [1, 3],
        [null, null],
      ]);
      const backOnly = planReducer(state, { type: 'removeSection', section: 0 });
      expect(ids(backOnly)[1]).toEqual([3, 1]);
      expect(backOnly.journeys.every((journey) => journey.stayMin === null)).toBe(true);
    });
    it('loads whole alternatives of a compared trip', () => {
      const state = planReducer(createPlanState(), {
        type: 'load',
        trip: true,
        sections: 2,
        journeys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({ airportIds: [id, 20], stayMin: 1440 })),
      });
      expect(planKind(state)).toBe('compareTrips');
      expect(planShape(state)).toEqual({ sections: 2, options: 4, option: 0, section: 0 });
      expect(state.journeys.map((journey) => journey.stayMin)).toEqual([
        null,
        1440,
        null,
        1440,
        null,
        1440,
        null,
        1440,
      ]);
    });
  });
});

it('loads tracks, compares them structurally, and starts the return with generated geometry', () => {
  const track: import('../lib/track.ts').CustomTrack = {
    kind: 'planned',
    source: { format: 'document', name: null },
    points: [
      { lat: 0, lng: 0, altM: null, time: null },
      { lat: 1, lng: 1, altM: null, time: null },
    ],
  };
  const action = { type: 'load' as const, journeys: [{ airportIds: [1, 2], tracks: [track] }] };
  const state = planReducer(createPlanState(), action);
  expect(state.journeys[0].route.stops[0].track?.track).toBe(track);
  expect(planReducer(state, { ...structuredClone(action), continued: true })).toBe(state);
  const returned = planReducer(state, { type: 'addReturn' });
  expect(returned.journeys[0].route.stops[0].track?.track).toBe(track);
  expect(returned.journeys[1].route.stops.every((s) => !s.track)).toBe(true);
  expect(planReducer(state, { ...action, journeys: [{ airportIds: [1, 2], tracks: [] }] })).not.toBe(state);
});

it('advances generation only for replacement loads, including identical and empty loads', () => {
  const initial = createPlanState();
  expect(initial.generation).toBe(0);
  const loaded = planReducer(initial, { type: 'load', journeys: [] });
  expect(loaded.generation).toBe(1);
  expect(loaded.journeys).toBe(initial.journeys);
  const input = [{ airportIds: [1, 2] }];
  let state = planReducer(loaded, { type: 'load', journeys: input });
  expect(state.generation).toBe(2);
  state = planReducer(state, { type: 'load', journeys: input });
  expect(state.generation).toBe(3);
  state = planReducer(state, { type: 'load', journeys: [{ airportIds: [1, 3] }], continued: true });
  expect(state.generation).toBe(3);
  const actions = [
    { type: 'route', action: { type: 'setAirport', index: 0, airportId: 7 } },
    { type: 'setLabel', index: 0, label: 'Named' },
    { type: 'add' },
    { type: 'activate', index: 0 },
    { type: 'remove', index: 1 },
    { type: 'addReturn' },
    { type: 'setStay', index: 1, minutes: 1440 },
    { type: 'addSection' },
    { type: 'add' },
    { type: 'removeSection', section: 2 },
    { type: 'removeOption', option: 1 },
  ] satisfies import('./plan.ts').PlanAction[];
  for (const action of actions) {
    state = planReducer(state, action);
    expect(state.generation).toBe(3);
  }
});
