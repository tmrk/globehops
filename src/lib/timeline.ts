import { displayAltitudeKm, trackFractionAtTime, trackFlightPhaseAt } from './track.ts';
import type { LatLng } from '../types.ts';
import type { Journey } from './schedule.ts';
import { interpolateGreatCircle } from './geo.ts';
import { pointAlongPath } from './routePath.ts';
import { altitudeAt, altitudeProfile, type AltitudeProfile } from './altitude.ts';
import { progressModel, distanceFractionAt, flightPhaseAt, type ProgressModel } from './flightProgress.ts';
type FlightSegment = { kind: 'flight'; leg: number; start: number; end: number };
export type TimelineSegment = FlightSegment | { kind: 'ground'; stop: number; start: number; end: number };

interface FlightModels {
  distanceKm: number;
  durationMin: number;
  progress: ProgressModel;
  altitude: AltitudeProfile;
}
// Timelines outlive playback frames; weak keys release their models when a route is replaced.
const flightModels = new WeakMap<FlightSegment, FlightModels>();
function modelsFor(segment: FlightSegment, distanceKm: number, durationMin: number): FlightModels {
  let models = flightModels.get(segment);
  if (!models || models.distanceKm !== distanceKm || models.durationMin !== durationMin) {
    models = {
      distanceKm,
      durationMin,
      progress: progressModel(distanceKm, durationMin),
      altitude: altitudeProfile(distanceKm),
    };
    flightModels.set(segment, models);
  }
  return models;
}

export interface Timeline {
  journeyId: string;
  start: number;
  end: number;
  segments: TimelineSegment[];
}
export function buildTimeline(j: Journey): Timeline | null {
  if (!j.playable || !j.start || !j.end) return null;
  const segments: TimelineSegment[] = [];
  for (const leg of j.legs) {
    if (leg.departure && leg.arrival && leg.arrival.epochMs > leg.departure.epochMs)
      segments.push({ kind: 'flight', leg: leg.index, start: leg.departure.epochMs, end: leg.arrival.epochMs });
    const transfer = j.transfers.find((t) => t.stop === leg.toStop);
    if (transfer?.arrival && transfer.departure && transfer.departure.epochMs > transfer.arrival.epochMs)
      segments.push({
        kind: 'ground',
        stop: transfer.stop,
        start: transfer.arrival.epochMs,
        end: transfer.departure.epochMs,
      });
  }
  return { journeyId: j.id, start: j.start.epochMs, end: j.end.epochMs, segments };
}
export type JourneyState =
  | { phase: 'before'; stop: 0; leg: 0; nextDeparture: number }
  | {
      phase: 'flight';
      leg: number;
      timeFraction: number;
      distanceFraction: number;
      position: LatLng;
      altitudeKm: number;
      flightPhase: 'climb' | 'cruise' | 'descent';
      elapsedMin: number;
      remainingMin: number;
    }
  | { phase: 'transfer'; stop: number; leg: number; arrival: number; departure: number; untilDepartureMin: number }
  | { phase: 'after'; stop: number; leg: number };
export function journeyStateAt(j: Journey, tl: Timeline, epochMs: number): JourneyState {
  if (epochMs < tl.start) return { phase: 'before', stop: 0, leg: 0, nextDeparture: tl.start };
  const segment = epochMs < tl.end ? tl.segments.find((s) => epochMs >= s.start && epochMs < s.end) : undefined;
  if (!segment) return { phase: 'after', stop: j.stops.length - 1, leg: Math.max(0, j.legs.length - 1) };
  if (segment.kind === 'ground')
    return {
      phase: 'transfer',
      stop: segment.stop,
      leg: segment.stop,
      arrival: segment.start,
      departure: segment.end,
      untilDepartureMin: (segment.end - epochMs) / 60000,
    };
  const leg = j.legs[segment.leg];
  const elapsedMin = (epochMs - segment.start) / 60000;
  const duration = (segment.end - segment.start) / 60000;
  const models = modelsFor(segment, leg.distanceKm, duration);
  const track = leg.track;
  const recordedTime = track?.times
    ? track.times[0] + (elapsedMin / duration) * (track.times.at(-1)! - track.times[0])
    : null;
  const distanceFraction =
    track && recordedTime !== null
      ? trackFractionAtTime(track, recordedTime)
      : distanceFractionAt(models.progress, elapsedMin);
  return {
    phase: 'flight',
    leg: leg.index,
    timeFraction: elapsedMin / duration,
    distanceFraction,
    position: track
      ? pointAlongPath(track.path, distanceFraction)
      : leg.route?.path
        ? pointAlongPath(leg.route.path, distanceFraction)
        : interpolateGreatCircle(leg.from, leg.to, distanceFraction),
    altitudeKm:
      (track ? displayAltitudeKm(track.path, track.altitudesKm, track.kind, distanceFraction) : null) ??
      altitudeAt(models.altitude, distanceFraction * leg.distanceKm),
    flightPhase:
      track && recordedTime !== null
        ? trackFlightPhaseAt(track, recordedTime)
        : flightPhaseAt(models.progress, elapsedMin),
    elapsedMin,
    remainingMin: duration - elapsedMin,
  };
}
