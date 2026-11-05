import type { LatLng } from '../types.ts';

export type AircraftView =
  /** Fraction of the leg's distance, in [0, 1]. */
  | { kind: 'air'; leg: number; fraction: number }
  /** Parked at the endpoint, with the nose following the leg's forward heading. */
  | { kind: 'ground'; leg: number; at: 'start' | 'end' };

export interface SimFrame {
  /** Null preserves the camera-following daylight appearance. */
  subsolar: LatLng | null;
  aircraft: AircraftView | null;
  highlightLeg: number | null;
  follow: boolean;
}

export interface SimulationFeed {
  subscribe(listener: () => void): () => void;
  /** Stable until the frame changes. */
  getFrame(): SimFrame;
}
