/**
 * Trips: ordered, independent journeys (outbound, return, further stages) separated by explicit stays.
 *
 * A connection belongs inside a journey (a transfer between two of its flights); a stay belongs between
 * journeys. The split is the traveller's: nothing here turns a long connection into a stay, or a short
 * stay into a connection. Each journey keeps its own entered times and schedule; a journey without any
 * entered time is placed from its neighbour through the stay setting, and says so in its provenance.
 */
import type { Airport } from '../types.ts';
import type { Journey, JourneyInput, TimePoint } from './schedule.ts';
import { buildTimeline, journeyStateAt, type JourneyState, type Timeline } from './timeline.ts';
import { routedJourney, type LegRouter } from './compare.ts';
import { localDayDifference, utcToLocal } from './timezone.ts';

export const MAX_SECTIONS = 6;
/** Until a journey's own times fix it, a stay lasts a week. */
export const DEFAULT_STAY_MIN = 7 * 1440;
export const MAX_STAY_MIN = 365 * 1440;
/** Choices offered for an untimed stay (minutes): hours for day trips, then days and weeks. */
export const STAY_CHOICES = [
  6 * 60,
  12 * 60,
  1440,
  2 * 1440,
  3 * 1440,
  4 * 1440,
  5 * 1440,
  6 * 1440,
  7 * 1440,
  10 * 1440,
  14 * 1440,
  21 * 1440,
  28 * 1440,
] as const;

export function isValidStay(minutes: number | null | undefined): minutes is number {
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_STAY_MIN;
}
/** Stored stays are null when they equal the default, so only real changes reach links. */
export function normalizeStay(minutes: number | null | undefined): number | null {
  return isValidStay(minutes) && minutes !== DEFAULT_STAY_MIN ? minutes : null;
}
/** The stay menu: the standard choices plus the current value when it is a custom one. */
export function stayChoices(current: number): number[] {
  const choices: number[] = [...STAY_CHOICES];
  if (!choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => a - b);
}

export interface TripSectionInput {
  label: string | null;
  /** The stay before this journey (ignored for the first); null for the default. */
  stayMin: number | null;
  input: JourneyInput;
}

/** How a journey got its times: its own entries, its neighbour through a stay, an example start, or none. */
export type SectionAnchor = 'entered' | 'estimated' | 'assumed' | 'none';

export interface TripSection {
  index: number;
  label: string | null;
  journey: Journey;
  timeline: Timeline | null;
  anchor: SectionAnchor;
  /** Index of the first flight in the trip's flattened flight list. */
  legOffset: number;
}

export interface TripStay {
  /** The journey that follows the stay (≥ 1); `after` is the one it follows. */
  section: number;
  after: number;
  /** Where the traveller arrives, and where the next journey departs (different for an open jaw). */
  arrivalAirport: Airport;
  departureAirport: Airport;
  arrival: TimePoint | null;
  departure: TimePoint | null;
  minutes: number;
  /** `times`: both journeys' own times fix it; `setting`: one journey was placed from the other by it. */
  source: 'times' | 'setting';
  custom: boolean;
  /** Calendar days between arrival and departure at the arrival airport (local dates), when timed. */
  days: number | null;
}

export type TripIssueCode = 'stay_overlap';
export interface TripIssue {
  code: TripIssueCode;
  severity: 'error';
  message: string;
  section: number;
}

export interface TripTimeline {
  start: number;
  end: number;
  /** Journeys with flights and a timeline, in order. */
  sections: { index: number; legOffset: number; timeline: Timeline }[];
  /** Ground time between consecutive timed journeys, in absolute UTC. */
  stays: { section: number; after: number; start: number; end: number }[];
}

export interface Trip {
  sections: TripSection[];
  stays: TripStay[];
  start: TimePoint | null;
  end: TimePoint | null;
  /** Any journey has an entered time. */
  dated: boolean;
  totals: {
    distanceKm: number;
    flightMin: number;
    connectionMin: number;
    stayMin: number;
    /** First departure to last arrival, or flights + connections + stays before times are known. */
    tripMin: number;
    flights: number;
    connections: number;
    journeys: number;
    stays: number;
  };
  issues: TripIssue[];
  playable: boolean;
  timeline: TripTimeline | null;
}

export interface TripOptions {
  /** Example start for a trip without any entered time (the timeline is open). */
  assumedStart: number | null;
  now?: number;
  route?: LegRouter;
  /**
   * Compared trips: for a trip without any entered time, the start (UTC ms) of the same journey in the
   * timed trips it is compared with. Each journey lines up with its counterpart, except that a stay the
   * traveller chose keeps its length. Ignored when the trip has entered times of its own.
   */
  align?: readonly (number | null)[];
  /** Journey ids are `${idPrefix}1`, `${idPrefix}2`, …; compared trips use their letter. */
  idPrefix?: string;
}

const hasFlights = (journey: Journey) => journey.legs.length > 0;

/** Local calendar days between two instants at one airport's clock. */
function calendarDays(zone: string, from: number, to: number): number {
  return localDayDifference(utcToLocal(zone, from), utcToLocal(zone, to));
}

export function computeTrip(inputs: TripSectionInput[], opts: TripOptions): Trip {
  const list = inputs.slice(0, MAX_SECTIONS);
  const ids = list.map((_, i) => `${opts.idPrefix ?? 'S'}${i + 1}`);
  const stay = (k: number) => list[k].stayMin ?? DEFAULT_STAY_MIN;
  const compute = (k: number, anchor: Parameters<typeof routedJourney>[1]['anchor'] = null) =>
    routedJourney({ ...list[k].input, id: ids[k] }, { now: opts.now, anchor }, opts.route);

  const journeys = list.map((_, k) => compute(k));
  const anchors: SectionAnchor[] = journeys.map((j) => (j.dated ? 'entered' : 'none'));
  /** Neighbour each untimed journey was placed from: -1 earlier, +1 later; 2 when lined up with another trip. */
  const placedFrom = list.map(() => 0);
  const timed = list.map((_, k) => journeys[k].dated);
  const withFlights = list.map((_, k) => k).filter((k) => hasFlights(journeys[k]));
  const previous = (k: number) => withFlights[withFlights.indexOf(k) - 1];
  const next = (k: number) => withFlights[withFlights.indexOf(k) + 1];
  // A neighbour placed only by assumption (or by a default stay) passes that uncertainty on.
  const provenance = (base: TimePoint, stayIndex: number): 'estimated' | 'assumed' =>
    base.provenance === 'assumed' || list[stayIndex].stayMin === null ? 'assumed' : 'estimated';
  const place = (k: number, at: 'start' | 'end', epochMs: number, prov: 'estimated' | 'assumed', from: number) => {
    journeys[k] = compute(k, { at, epochMs, provenance: prov });
    anchors[k] = prov;
    placedFrom[k] = from;
  };
  const forward = () => {
    for (const k of withFlights) {
      const p = previous(k);
      if (timed[k] || anchors[k] !== 'none' || p === undefined) continue;
      const end = journeys[p].end;
      if (end) place(k, 'start', end.epochMs + stay(k) * 60000, provenance(end, k), -1);
    }
  };
  const backward = () => {
    for (const k of [...withFlights].reverse()) {
      const n = next(k);
      if (timed[k] || anchors[k] !== 'none' || n === undefined) continue;
      const start = journeys[n].start;
      if (start) place(k, 'end', start.epochMs - stay(n) * 60000, provenance(start, n), 1);
    }
  };
  // An untimed trip lines up journey by journey with the timed trips it is compared with, unless the
  // traveller chose the stay before a journey, or lining up would leave before the previous one lands.
  if (opts.align && !timed.some(Boolean))
    for (const k of withFlights) {
      const start = opts.align[k];
      const p = previous(k);
      const landed = p === undefined ? undefined : journeys[p].end?.epochMs;
      if (start != null && (p === undefined || list[k].stayMin === null) && (landed === undefined || start >= landed)) {
        journeys[k] = compute(k, { at: 'start', epochMs: start, provenance: 'assumed' });
        anchors[k] = 'assumed';
        placedFrom[k] = 2;
      } else if (p !== undefined && anchors[p] !== 'none' && journeys[p].end)
        place(k, 'start', journeys[p].end!.epochMs + stay(k) * 60000, provenance(journeys[p].end!, k), -1);
    }
  forward();
  backward();
  const first = withFlights[0];
  if (first !== undefined && !anchors.some((a) => a !== 'none') && opts.assumedStart !== null) {
    journeys[first] = routedJourney(
      { ...list[first].input, id: ids[first] },
      { now: opts.now, assumedStart: opts.assumedStart },
      opts.route,
    );
    anchors[first] = journeys[first].start ? 'assumed' : 'none';
    forward();
  }

  let offset = 0;
  const sections: TripSection[] = list.map((entry, index) => {
    const journey = journeys[index];
    const section: TripSection = {
      index,
      label: entry.label,
      journey,
      timeline: buildTimeline(journey),
      anchor: anchors[index],
      legOffset: offset,
    };
    offset += journey.legs.length;
    return section;
  });

  const issues: TripIssue[] = [];
  const stays: TripStay[] = withFlights.slice(1).map((k) => {
    const p = previous(k)!;
    const before = journeys[p],
      after = journeys[k];
    const arrival = before.end,
      departure = after.start;
    const arrivalAirport = before.stops[before.stops.length - 1].airport;
    const minutes = arrival && departure ? (departure.epochMs - arrival.epochMs) / 60000 : stay(k);
    const fromSetting = placedFrom[k] === -1 || placedFrom[k] === 2 || placedFrom[p] === 1 || !arrival || !departure;
    if (minutes < 0)
      issues.push({
        code: 'stay_overlap',
        severity: 'error',
        section: k,
        message: `Journey ${k + 1} departs before journey ${p + 1} arrives.`,
      });
    return {
      section: k,
      after: p,
      arrivalAirport,
      departureAirport: after.stops[0].airport,
      arrival,
      departure,
      minutes,
      source: fromSetting ? 'setting' : 'times',
      custom: list[k].stayMin !== null,
      days: arrival && departure ? calendarDays(arrival.zone, arrival.epochMs, departure.epochMs) : null,
    };
  });

  const flown = sections.filter((s) => hasFlights(s.journey));
  const start = flown[0]?.journey.start ?? null;
  const end = flown.at(-1)?.journey.end ?? null;
  const sum = (pick: (j: Journey) => number) => flown.reduce((total, s) => total + pick(s.journey), 0);
  const flightMin = sum((j) => j.totals.flightMin);
  const connectionMin = sum((j) => j.totals.layoverMin);
  const stayMin = stays.reduce((total, s) => total + s.minutes, 0);
  const errors = issues.length > 0 || flown.some((s) => s.journey.issues.some((i) => i.severity === 'error'));
  const playable = flown.length > 0 && !errors && flown.every((s) => s.timeline !== null);
  const timeline: TripTimeline | null =
    playable && start && end
      ? {
          start: start.epochMs,
          end: end.epochMs,
          sections: flown.map((s) => ({ index: s.index, legOffset: s.legOffset, timeline: s.timeline! })),
          stays: stays.flatMap((s) =>
            s.arrival && s.departure && s.minutes > 0
              ? [{ section: s.section, after: s.after, start: s.arrival.epochMs, end: s.departure.epochMs }]
              : [],
          ),
        }
      : null;
  return {
    sections,
    stays,
    start,
    end,
    dated: journeys.some((j) => j.dated),
    totals: {
      distanceKm: sum((j) => j.totals.distanceKm),
      flightMin,
      connectionMin,
      stayMin,
      tripMin: start && end ? (end.epochMs - start.epochMs) / 60000 : flightMin + connectionMin + stayMin,
      flights: sum((j) => j.totals.flights),
      connections: sum((j) => j.totals.transfers),
      journeys: flown.length,
      stays: stays.length,
    },
    issues,
    playable,
    timeline,
  };
}

export type TripState =
  | { phase: 'journey'; section: number; legOffset: number; state: JourneyState }
  | {
      phase: 'stay';
      /** The journey that follows the stay, and the one it follows. */
      section: number;
      after: number;
      arrival: number;
      departure: number;
      untilDepartureMin: number;
    };

/** Where the single traveller is at an instant: inside a journey (including before/after), or staying between two. */
export function tripStateAt(trip: Trip, tl: TripTimeline, epochMs: number): TripState {
  const sections = tl.sections;
  for (let i = 0; i < sections.length; i++) {
    const entry = sections[i];
    const journey = trip.sections[entry.index].journey;
    const last = i === sections.length - 1;
    if (epochMs < entry.timeline.start && i > 0) {
      const prior = sections[i - 1];
      return {
        phase: 'stay',
        section: entry.index,
        after: prior.index,
        arrival: prior.timeline.end,
        departure: entry.timeline.start,
        untilDepartureMin: (entry.timeline.start - epochMs) / 60000,
      };
    }
    if (epochMs < entry.timeline.end || last)
      return {
        phase: 'journey',
        section: entry.index,
        legOffset: entry.legOffset,
        state: journeyStateAt(journey, entry.timeline, epochMs),
      };
  }
  throw new RangeError('A trip timeline has at least one journey.');
}

/** How long playback lingers after landing before skipping a stay, and the lead-in before the next departure. */
export const STAY_ARRIVAL_MS = 20 * 60_000;
export const STAY_LEAD_MS = 30 * 60_000;

/**
 * Stays that automatic playback skips: from just after arrival to just before the next departure. Real
 * UTC instants are never changed; the clock only jumps across them while playing.
 */
export function stayPlaybackSkips(tl: TripTimeline): { from: number; to: number }[] {
  return tl.stays.flatMap(({ start, end }) => {
    const from = start + STAY_ARRIVAL_MS,
      to = end - STAY_LEAD_MS;
    return to - from >= 60 * 60_000 ? [{ from, to }] : [];
  });
}

/** Total flights before a journey: links number flights across the whole trip. */
export function sectionOfFlight(trip: Trip, globalLeg: number): { section: number; leg: number } | null {
  for (const s of trip.sections)
    if (globalLeg >= s.legOffset && globalLeg < s.legOffset + s.journey.legs.length)
      return { section: s.index, leg: globalLeg - s.legOffset };
  return null;
}

/** Whether a journey ends where the trip began (same airport, or the same city and country). */
export function returnsHome(first: Airport | undefined, last: Airport | undefined): boolean {
  if (!first || !last) return false;
  if (first.id === last.id) return true;
  return !!first.city && first.city === last.city && first.countryCode === last.countryCode;
}

/** The default name of a journey in a trip: outbound, return when it comes home, else its position. */
export type SectionRole = 'outbound' | 'return' | 'onward';
export function sectionRole(index: number, count: number, first?: Airport, last?: Airport): SectionRole {
  if (index === 0) return 'outbound';
  return index === count - 1 && returnsHome(first, last) ? 'return' : 'onward';
}
