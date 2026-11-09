/** Shared domain types. Keep this file dependency-free. */

export type AirportType = 'large' | 'medium' | 'small' | 'seaplane' | 'heliport';

export interface Airport {
  /** Stable OurAirports numeric record id. Used internally as the primary key. */
  id: number;
  /** OurAirports `ident` (always present, usually equals the ICAO code). */
  ident: string;
  iata: string | null;
  icao: string | null;
  name: string;
  /** Municipality served, '' when unknown. */
  city: string;
  /** Region/state name, only populated where customary in place names (US, CA, AU). */
  region: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** English country name. */
  country: string;
  lat: number;
  lng: number;
  type: AirportType;
  /** OurAirports `scheduled_service` = yes. */
  scheduled: boolean;
  /** Alternative names / keywords from OurAirports (plus documented local aliases). */
  keywords: string[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type DistanceUnit = 'km' | 'mi';

/**
 * How a flight relates to restricted airspace: `clear` (the great circle crosses none), `detour`
 * (routed around every applicable zone), `partial` (it starts or ends inside a zone, which it must
 * cross; any others are avoided) or `unavoided` (no valid detour, so the great circle is kept).
 * Paths may also come from diversion coverage.
 */
export type AirspaceStatus = 'clear' | 'detour' | 'partial' | 'unavoided';

export type DiversionStatus = 'covered' | 'adjusted' | 'gap';
export interface DiversionCoverage {
  /** Profile id, e.g. 'twin-180'. */
  profile: string;
  /** Profile limit in minutes at the assumed one-engine-inoperative speed. */
  limitMin: number;
  /** covered: the route without this constraint already stays within the limit; adjusted: re-routed to stay within it;
   * gap: no plausible route stays within it, so the unconstrained route is shown. */
  status: DiversionStatus;
  /** Longest modelled diversion time along the shown route (minutes, rounded up). */
  maxMin: number;
  /** Distance of the shown route farther than the limit from any potential diversion airport (km, 0 unless gap). */
  outsideKm: number;
  /** Extra distance flown to stay within the limit compared with the route without this constraint (km, 0 unless adjusted). */
  extraKm: number;
  /** Distance of the shown route beyond the 60-minute threshold (km, informational). */
  beyondThresholdKm: number;
}

/** A great circle or a path shaped by restricted airspace and/or diversion coverage. */
export interface LegRoute {
  status: AirspaceStatus;
  /** Waypoints shaped by airspace and/or diversion coverage, at most ~1° apart; null follows the great circle. */
  path: LatLng[] | null;
  /** Length of the flown route: the path, or the great circle when there is none. */
  distanceKm: number;
  greatCircleKm: number;
  /** Zone ids the great circle would cross and the route goes around. */
  avoided: string[];
  /** Applicable zone ids the shown route still crosses: avoidance is not guaranteed. */
  crossed: string[];
  /** Display places (ISO country codes or marine slugs) of `avoided` and `crossed`, deduplicated. */
  avoidedPlaces: string[];
  crossedPlaces: string[];
  /** Present only when the diversion model ran. */
  diversion?: DiversionCoverage;
}

export interface LocalTimeInput {
  /** Local wall time (YYYY-MM-DDTHH:MM), or a date awaiting a time. */
  local: string;
  /** Explicit UTC offset in minutes, or null when none has been chosen. */
  offsetMin: number | null;
}

export interface Stop {
  /** Stable key for React lists (not persisted). */
  key: string;
  airportId: number | null;
  /** Connection time when this stop is a transfer; null means the default. */
  layoverMin: number | null;
  arrival: LocalTimeInput | null;
  departure: LocalTimeInput | null;
}

export interface RouteState {
  stops: Stop[];
  /** Index into the computed legs array, or null for the full-route view. */
  selectedLeg: number | null;
}

export interface Leg {
  /** 0-based leg number. */
  index: number;
  from: Airport;
  to: Airport;
  /** Indices into RouteState.stops. */
  fromStop: number;
  toStop: number;
  distanceKm: number;
  /** Estimated flight time in minutes, null for a zero-length leg. */
  durationMin: number | null;
  /** Airspace-aware route, present only while avoidance is on. */
  route?: LegRoute;
}

/** Time on the ground at a transfer stop, between two consecutive legs. */
export interface Layover {
  /** Index into RouteState.stops. */
  stopIndex: number;
  airport: Airport;
  minutes: number;
  /** True when the user changed it from the default. */
  custom: boolean;
}
