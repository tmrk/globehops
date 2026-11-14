import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  addSavedTrip,
  canonicalTripQuery,
  findSavedTrip,
  loadSavedTrips,
  removeSavedTrip,
  restoreSavedTrip,
  SAVED_TRIPS_KEY,
  storeSavedTrips,
  updateSavedTrip,
  type SavedTrip,
} from '../state/savedTrips.ts';
import { summarizeSavedTrip, type SavedTripSummary } from '../state/savedTripSummary.ts';

export interface SavedTripView extends SavedTrip {
  summary: SavedTripSummary;
}
export interface RemovedTrip {
  trip: SavedTrip;
  index: number;
}
interface Attachment {
  id: string;
  generation: number;
}
interface SavedState {
  trips: SavedTripView[];
  attachment: Attachment | null;
}

export function useSavedTrips({
  journeyQuery,
  generation,
  ready,
}: {
  journeyQuery: string;
  generation: number;
  ready: boolean;
}): {
  trips: SavedTripView[];
  currentId: string | null;
  save: () => 'saved' | 'full' | 'failed';
  unsave: () => void;
  remove: (id: string) => RemovedTrip | null;
  restore: (removed: RemovedTrip) => void;
  markOpening: (id: string) => void;
} {
  const [state, setState] = useState<SavedState>(() => ({
    trips: loadSavedTrips().map((trip) => ({ ...trip, summary: summarizeSavedTrip(trip.query) })),
    attachment: null,
  }));
  // Event handlers and effects share the latest committed change, including batched user actions.
  const current = useRef(state);
  const opening = useRef<string | null>(null);
  const seenGeneration = useRef<number | null>(null);
  const query = useMemo(() => canonicalTripQuery(journeyQuery), [journeyQuery]);
  const commit = (next: { trips: SavedTrip[]; attachment: Attachment | null }) => {
    const cache = new Map(current.current.trips.map((trip) => [trip.query, trip.summary]));
    const committed = {
      ...next,
      trips: next.trips.map((trip) => ({ ...trip, summary: cache.get(trip.query) ?? summarizeSavedTrip(trip.query) })),
    };
    current.current = committed;
    setState(committed);
  };
  const synchronize = useEffectEvent(() => {
    if (!ready) {
      seenGeneration.current = null;
      return;
    }
    const previous = current.current;
    if (seenGeneration.current !== generation) {
      seenGeneration.current = generation;
      const target =
        opening.current !== null
          ? previous.trips.find((trip) => trip.id === opening.current)
          : findSavedTrip(previous.trips, query);
      opening.current = null;
      commit({ ...previous, attachment: target ? { id: target.id, generation } : null });
      return;
    }
    if (previous.attachment?.generation !== generation || !query) return;
    const trips = updateSavedTrip(previous.trips, previous.attachment.id, query, Date.now());
    if (trips !== previous.trips && storeSavedTrips(trips)) commit({ ...previous, trips });
  });
  useEffect(() => {
    synchronize();
  }, [query, generation, ready]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SAVED_TRIPS_KEY && event.key !== null) return;
      const trips = loadSavedTrips();
      const attachment = current.current.attachment;
      commit({ trips, attachment: trips.some((trip) => trip.id === attachment?.id) ? attachment : null });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const remove = (id: string): RemovedTrip | null => {
    if (!ready) return null;
    const previous = current.current;
    const result = removeSavedTrip(previous.trips, id);
    if (!result.removed || !storeSavedTrips(result.trips)) return null;
    commit({ trips: result.trips, attachment: previous.attachment?.id === id ? null : previous.attachment });
    return result.removed;
  };
  return {
    trips: state.trips,
    currentId: ready && state.attachment?.generation === generation ? state.attachment.id : null,
    save: () => {
      if (!ready || !query) return 'failed';
      const result = addSavedTrip(current.current.trips, query, Date.now());
      if (!result) return 'full';
      if (!storeSavedTrips(result.trips)) return 'failed';
      commit({ trips: result.trips, attachment: { id: result.trip.id, generation } });
      return 'saved';
    },
    unsave: () => {
      const id = current.current.attachment?.id;
      if (id) remove(id);
    },
    remove,
    restore: (removed) => {
      if (!ready) return;
      const previous = current.current;
      const restored = restoreSavedTrip(previous.trips, removed);
      if (!storeSavedTrips(restored)) return;
      commit({
        trips: restored,
        attachment:
          ready && query && query === removed.trip.query && restored.some((trip) => trip.id === removed.trip.id)
            ? { id: removed.trip.id, generation }
            : previous.attachment,
      });
    },
    markOpening: (id) => {
      opening.current = id;
    },
  };
}
