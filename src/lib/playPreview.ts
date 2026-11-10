/**
 * The play button's preview strip: a miniature of the timeline it opens. Flights are bars in their own
 * colours, connections dotted gaps between them and a trip's stays short breaks, so the strip reads as
 * "the journey you are about to watch" before any time is known.
 */
import type { Journey } from './schedule.ts';
import type { Trip } from './trip.ts';
import { legColor } from './legColors.ts';

export interface PreviewSegment {
  kind: 'flight' | 'ground';
  /** Position along the strip, 0 … 1. */
  start: number;
  end: number;
  /** Flights only: the leg's colour. */
  color?: string;
}
export interface PreviewLane {
  /** A compared journey's colour, or null for a single traveller. */
  color: string | null;
  segments: PreviewSegment[];
}

/** A trip's stay, drawn as a short break whatever its length: days would dwarf every flight. */
export const STAY_SHARE = 0.06;

interface Piece {
  kind: 'flight' | 'ground' | 'stay';
  minutes: number;
  /** Flights: the leg's number across the trip. */
  leg: number;
}

/** A journey's flights and connections in order, from its times when known, else its estimates. */
function journeyPieces(journey: Journey, legOffset = 0): Piece[] {
  const out: Piece[] = [];
  journey.legs.forEach((leg, i) => {
    const timed = leg.departure && leg.arrival ? (leg.arrival.epochMs - leg.departure.epochMs) / 60000 : null;
    const minutes = Math.max(1, timed ?? leg.durationMin ?? leg.estimatedMin ?? 1);
    out.push({ kind: 'flight', minutes, leg: legOffset + i });
    const transfer = i < journey.legs.length - 1 ? journey.transfers.find((t) => t.stop === leg.toStop) : undefined;
    if (transfer) out.push({ kind: 'ground', minutes: Math.max(0, transfer.minutes), leg: legOffset + i });
  });
  return out;
}

function tripPieces(trip: Trip): Piece[] {
  const out: Piece[] = [];
  for (const section of trip.sections) {
    if (!section.journey.legs.length) continue;
    if (out.length) out.push({ kind: 'stay', minutes: 0, leg: section.legOffset });
    out.push(...journeyPieces(section.journey, section.legOffset));
  }
  return out;
}

const minutesOf = (list: Piece[]) => list.reduce((sum, p) => sum + (p.kind === 'stay' ? 0 : p.minutes), 0);
const staysOf = (list: Piece[]) => list.filter((p) => p.kind === 'stay').length;

/**
 * Lays pieces end to end: each stay takes `STAY_SHARE` of the strip, and `scale` minutes of flights and
 * connections fill `room` of it.
 */
function lay(list: Piece[], scale: number, room: number, color: (leg: number) => string): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  let at = 0;
  for (const piece of list) {
    const width = piece.kind === 'stay' ? STAY_SHARE : scale > 0 ? (piece.minutes / scale) * room : 0;
    if (piece.kind === 'flight') out.push({ kind: 'flight', start: at, end: at + width, color: color(piece.leg) });
    else if (piece.kind === 'ground' && width > 0) out.push({ kind: 'ground', start: at, end: at + width });
    at += width;
  }
  return out;
}

function single(list: Piece[]): PreviewLane[] {
  if (!list.some((p) => p.kind === 'flight')) return [];
  return [{ color: null, segments: lay(list, minutesOf(list), 1 - staysOf(list) * STAY_SHARE, legColor) }];
}

/** One lane: a journey's flights in their leg colours. */
export function journeyPreview(journey: Journey): PreviewLane[] {
  return single(journeyPieces(journey));
}

/** One lane: a trip's journeys with their stays as short breaks; leg colours continue across the trip. */
export function tripPreview(trip: Trip): PreviewLane[] {
  return single(tripPieces(trip));
}

/**
 * One lane per compared journey or trip, in its colour, on one scale: the longest alternative fills the
 * strip, so a quicker one visibly finishes first.
 */
export function comparisonPreview(items: readonly { color: string; journey?: Journey; trip?: Trip }[]): PreviewLane[] {
  const lists = items.map((item) =>
    item.trip ? tripPieces(item.trip) : item.journey ? journeyPieces(item.journey) : [],
  );
  const room = 1 - Math.max(0, ...lists.map(staysOf)) * STAY_SHARE;
  const scale = Math.max(0, ...lists.map(minutesOf));
  return items.flatMap((item, i) =>
    lists[i].some((p) => p.kind === 'flight')
      ? [{ color: item.color, segments: lay(lists[i], scale, room, () => item.color) }]
      : [],
  );
}
