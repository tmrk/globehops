import type { Airport } from '../../types.ts';
import type { CustomTrack, TrackFormat, TrackKind, TrackPoint } from '../track.ts';
import type { NavaidDataset } from '../../data/navaids.ts';

export interface ImportContext {
  /** Full airport dataset; keep the array stable to reuse the spatial index. */
  airports: readonly Airport[];
  /** Exact, case-insensitive IATA/ICAO/ident lookup. */
  byCode: (code: string) => Airport | undefined;
  /** Optional local radio aids; identifiers remain unresolved when absent. */
  navaids?: NavaidDataset | null;
}
export interface ImportOptions {
  /** File name for detection and source attribution; null for pasted text. */
  fileName?: string | null;
  /** Override content/extension detection. */
  format?: TrackFormat;
}
export interface ImportedFlight {
  track: CustomTrack;
  from: Airport;
  to: Airport;
  /** Distance from the unchanged first point to the matched departure. */
  fromDistanceKm: number;
  /** Distance from the unchanged last point to the matched arrival. */
  toDistanceKm: number;
}
export type ImportErrorCode = 'empty' | 'too_large' | 'unrecognised' | 'invalid' | 'no_path' | 'unsupported';
export type ImportWarningCode =
  | 'dropped_points'
  | 'far_endpoint'
  | 'unresolved_waypoints'
  | 'airway_direct'
  | 'procedure_direct'
  | 'ambiguous_waypoint'
  | 'times_unordered'
  | 'times_partial'
  | 'altitude_feet_assumed'
  | 'altitude_dropped'
  | 'split_flights'
  | 'truncated_flights'
  | 'same_airport'
  | 'kml_line_preferred';
export interface ImportIssue<C extends string> {
  code: C;
  message: string;
  params: Record<string, string | number>;
}
export interface ImportResult {
  /** True exactly when at least one flight was produced. */
  ok: boolean;
  format: TrackFormat | null;
  /** Document/track name, otherwise the file name without its final extension. */
  name: string | null;
  flights: ImportedFlight[];
  warnings: ImportIssue<ImportWarningCode>[];
  error: ImportIssue<ImportErrorCode> | null;
  /** Valid source points read (including ignored duplicates/overflow), and invalid positions. */
  stats: { points: number; droppedPoints: number };
}
export const MAX_IMPORT_FLIGHTS = 54;
/** Internal parser output. Endpoint hints are always checked against the actual geometry. */
export interface ParsedPath {
  points: TrackPoint[];
  name?: string | null;
  description?: string | null;
  kind?: TrackKind;
}
export interface ParsedDocument {
  paths: ParsedPath[];
  name?: string | null;
}
