import { computeJourney, type Journey, type JourneyInput } from './schedule.ts';
import { buildTimeline, type Timeline } from './timeline.ts';

export const JOURNEY_IDS = ['A', 'B', 'C', 'D'] as const;
export type JourneyId = (typeof JOURNEY_IDS)[number];
export const JOURNEY_COLORS = ['#ffc24b', '#5ea8f2', '#f0607e', '#56d3a6'] as const;
export const MAX_JOURNEYS = 4;
export function journeyColor(index: number): string {
  return JOURNEY_COLORS[index % MAX_JOURNEYS];
}
export interface ComparisonInput {
  label: string | null;
  input: JourneyInput;
}
export interface ComparedJourney {
  id: JourneyId;
  index: number;
  label: string | null;
  color: string;
  journey: Journey;
  timeline: Timeline | null;
  anchor: 'entered' | 'assumed' | 'none';
}
/** Preserve entered schedules; align only journeys without any entered time. */
export function computeComparison(
  inputs: ComparisonInput[],
  opts: { assumedStart: number | null; now?: number },
): ComparedJourney[] {
  const initial = inputs
    .slice(0, MAX_JOURNEYS)
    .map(({ input }, index) => computeJourney({ ...input, id: JOURNEY_IDS[index] }, { now: opts.now }));
  const starts = initial.flatMap((journey) => (journey.dated && journey.start ? [journey.start.epochMs] : []));
  const assumedStart = starts.length ? Math.min(...starts) : opts.assumedStart;
  return initial.map((original, index) => {
    const entered = inputs[index].input.stops.some((stop) => stop.arrival !== null || stop.departure !== null);
    const journey = entered
      ? original
      : computeJourney({ ...inputs[index].input, id: JOURNEY_IDS[index] }, { assumedStart, now: opts.now });
    return {
      id: JOURNEY_IDS[index],
      index,
      label: inputs[index].label,
      color: journeyColor(index),
      journey,
      timeline: buildTimeline(journey),
      anchor: journey.dated ? 'entered' : journey.start ? 'assumed' : 'none',
    };
  });
}
export interface JourneyMetrics {
  id: JourneyId;
  start: number | null;
  end: number | null;
  journeyMin: number;
  flightMin: number;
  layoverMin: number;
  flights: number;
  transfers: number;
  distanceKm: number;
  estimated: boolean;
}
export interface ComparisonMetrics {
  journeys: JourneyMetrics[];
  fastest: JourneyId | null;
  firstArrival: JourneyId | null;
  deltaMin: Record<JourneyId, number>;
}
export function compareMetrics(list: ComparedJourney[]): ComparisonMetrics {
  const journeys = list.map(({ id, journey }): JourneyMetrics => ({
    id,
    start: journey.start?.epochMs ?? null,
    end: journey.end?.epochMs ?? null,
    ...journey.totals,
    estimated:
      journey.legs.some(
        (leg) =>
          leg.durationSource !== 'entered' ||
          leg.departure?.provenance !== 'entered' ||
          leg.arrival?.provenance !== 'entered',
      ) ||
      journey.transfers.some(
        (transfer) =>
          transfer.source !== 'times' ||
          transfer.arrival?.provenance !== 'entered' ||
          transfer.departure?.provenance !== 'entered',
      ),
  }));
  const valid = journeys.filter(
    (_, index) =>
      list[index].journey.stops.length >= 2 && !list[index].journey.issues.some((issue) => issue.severity === 'error'),
  );
  const winner = (values: { id: JourneyId; value: number }[]): JourneyId | null => {
    if (values.length < 2) return null;
    const sorted = [...values].sort((a, b) => a.value - b.value);
    return sorted[0].value === sorted[1].value ? null : sorted[0].id;
  };
  const minimum = valid.length ? Math.min(...valid.map((journey) => journey.journeyMin)) : 0;
  const deltaMin: Record<JourneyId, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const journey of valid) deltaMin[journey.id] = journey.journeyMin - minimum;
  return {
    journeys,
    fastest: winner(valid.map((journey) => ({ id: journey.id, value: journey.journeyMin }))),
    firstArrival: valid.every((journey) => journey.end !== null)
      ? winner(valid.map((journey) => ({ id: journey.id, value: journey.end! })))
      : null,
    deltaMin,
  };
}
export function comparisonRange(list: ComparedJourney[]): { start: number; end: number } | null {
  const timelines = list.flatMap(({ timeline }) => (timeline ? [timeline] : []));
  return timelines.length
    ? {
        start: Math.min(...timelines.map((timeline) => timeline.start)),
        end: Math.max(...timelines.map((timeline) => timeline.end)),
      }
    : null;
}
