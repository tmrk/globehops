import { MAX_URL_LENGTH } from '../agent/contract.ts';
import { linkHasStops, parseLink, serializeLinkState } from './link.ts';

export const SAVED_TRIPS_KEY = 'globehops:savedTrips';
export const MAX_SAVED_TRIPS = 50;
export interface SavedTrip {
  id: string;
  query: string;
  savedAt: number;
  updatedAt: number;
}

/** Journey content only, in stable parameter order and with readable time separators. */
export function canonicalTripQuery(query: string): string {
  try {
    if (query.length > MAX_URL_LENGTH) return '';
    let source = new URLSearchParams(query);
    // Older document links carry journey content and view settings in one parameter.
    if ([...source.keys()].some((key) => key.toLowerCase() === 'itinerary')) {
      const link = parseLink(query);
      if (!linkHasStops(link)) return '';
      source = new URLSearchParams(serializeLinkState({ ...link, view: { ...link.view, time: null, play: false } }));
    }
    const params = new URLSearchParams();
    for (const [rawKey, value] of source) {
      const key = rawKey.toLowerCase();
      if (
        /^(?:[b-d]\.)?(?:[2-6]\.)?(?:route|label|(?:dep|arr|trk)[1-9]\d*)$/.test(key) ||
        /^(?:[b-d]\.)?[2-6]\.stay$/.test(key)
      ) {
        if (!params.has(key)) params.set(key, value);
      }
    }
    params.sort();
    const result = `?${params.toString().replace(/%3A/gi, ':')}`;
    return result.length <= MAX_URL_LENGTH && linkHasStops(parseLink(result)) ? result : '';
  } catch {
    return '';
  }
}

export function loadSavedTrips(): SavedTrip[] {
  try {
    const data: unknown = JSON.parse(globalThis.localStorage?.getItem(SAVED_TRIPS_KEY) ?? 'null');
    if (
      !data ||
      typeof data !== 'object' ||
      !('v' in data) ||
      data.v !== 1 ||
      !('trips' in data) ||
      !Array.isArray(data.trips)
    )
      return [];
    const ids = new Set<string>();
    const trips: SavedTrip[] = [];
    for (const entry of data.trips) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, query, savedAt, updatedAt } = entry as Record<string, unknown>;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        id.length > 100 ||
        ids.has(id) ||
        typeof query !== 'string' ||
        typeof savedAt !== 'number' ||
        !Number.isFinite(savedAt) ||
        savedAt < 0 ||
        typeof updatedAt !== 'number' ||
        !Number.isFinite(updatedAt) ||
        updatedAt < savedAt
      )
        continue;
      const canonical = canonicalTripQuery(query);
      if (!canonical) continue;
      ids.add(id);
      trips.push({ id, query: canonical, savedAt, updatedAt });
    }
    return trips.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function storeSavedTrips(trips: readonly SavedTrip[]): boolean {
  try {
    if (trips.some((trip) => trip.query.length > MAX_URL_LENGTH)) return false;
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(
      SAVED_TRIPS_KEY,
      JSON.stringify({
        v: 1,
        trips: trips.map(({ id, query, savedAt, updatedAt }) => ({ id, query, savedAt, updatedAt })),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function findSavedTrip(trips: readonly SavedTrip[], query: string): SavedTrip | undefined {
  const canonical = canonicalTripQuery(query);
  return canonical ? trips.find((trip) => canonicalTripQuery(trip.query) === canonical) : undefined;
}

export function addSavedTrip(
  trips: readonly SavedTrip[],
  query: string,
  now: number,
  id?: string,
): { trips: SavedTrip[]; trip: SavedTrip; added: boolean } | null {
  const canonical = canonicalTripQuery(query);
  if (!canonical) return null;
  const existing = findSavedTrip(trips, canonical);
  if (existing) return { trips: [...trips], trip: existing, added: false };
  if (trips.length >= MAX_SAVED_TRIPS) return null;
  const randomId = () =>
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  let nextId = id ?? randomId();
  while (trips.some((trip) => trip.id === nextId)) nextId = randomId();
  const trip = { id: nextId, query: canonical, savedAt: now, updatedAt: now };
  return { trips: [trip, ...trips], trip, added: true };
}

export function updateSavedTrip(trips: readonly SavedTrip[], id: string, query: string, now: number): SavedTrip[] {
  const canonical = canonicalTripQuery(query);
  const trip = trips.find((entry) => entry.id === id);
  if (!canonical || !trip || canonicalTripQuery(trip.query) === canonical) return trips as SavedTrip[];
  return trips
    .map((entry) => (entry === trip ? { ...entry, query: canonical, updatedAt: now } : entry))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeSavedTrip(
  trips: readonly SavedTrip[],
  id: string,
): { trips: SavedTrip[]; removed: { trip: SavedTrip; index: number } | null } {
  const index = trips.findIndex((trip) => trip.id === id);
  return index < 0
    ? { trips: trips as SavedTrip[], removed: null }
    : {
        trips: trips.filter((_, i) => i !== index),
        removed: { trip: trips[index], index },
      };
}

export function restoreSavedTrip(
  trips: readonly SavedTrip[],
  removed: { trip: SavedTrip; index: number },
): SavedTrip[] {
  if (trips.some((trip) => trip.id === removed.trip.id)) return trips as SavedTrip[];
  const restored = [...trips];
  restored.splice(Math.max(0, Math.min(removed.index, trips.length)), 0, removed.trip);
  return restored;
}
