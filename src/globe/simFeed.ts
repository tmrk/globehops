import type { MoonState } from '../lib/moon.ts';
import type { LatLng } from '../types.ts';

export type AircraftView =
  /** Fraction of the leg's distance, in [0, 1]. */
  | {
      kind: 'air';
      leg: number;
      fraction: number;
      /** Distance fraction per real second; absent while paused. Used only to predict camera lead. */
      fractionPerSecond?: number;
    }
  /** Parked at the endpoint, with the nose following the leg's forward heading. */
  | { kind: 'ground'; leg: number; at: 'start' | 'end' };

export interface FleetAircraft {
  /** Global leg index in the flattened globe route. */
  view: AircraftView;
  color: string;
  tag: string;
  highlightLeg: number | null;
}

/** The Sun and Moon at one instant, in the Earth-fixed frame of airports and textures. */
export interface Sky {
  /** Subsolar point. */
  sun: LatLng;
  sunDistanceKm: number;
  moon: MoonState;
}

export interface SimFrame {
  /** Null preserves the camera-following daylight appearance and hides the Sun and Moon. */
  sky: Sky | null;
  aircraft: AircraftView | null;
  highlightLeg: number | null;
  follow: boolean;
  /** Present only in compare mode, including parked aircraft. */
  fleet?: FleetAircraft[];
}

export interface SimulationFeed {
  subscribe(listener: () => void): () => void;
  /** Stable until the frame changes. */
  getFrame(): SimFrame;
}

/** Whether two aircraft views place the aircraft identically (and predict the same camera lead). */
export function sameAircraft(a: AircraftView | null, b: AircraftView | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.leg !== b.leg) return false;
  if (a.kind === 'ground') return b.kind === 'ground' && a.at === b.at;
  return b.kind === 'air' && a.fraction === b.fraction && a.fractionPerSecond === b.fractionPerSecond;
}
