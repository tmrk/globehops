import { decodeItineraryParam } from '../agent/itinerary.ts';
import type { LinkDefaultKey, LinkView } from './link.ts';
import type { DistanceUnit } from '../types.ts';
import {
  loadAvoidAirspace,
  loadBorders,
  loadClockZone,
  loadCountryNames,
  loadDayNight,
  loadFollowAircraft,
  loadMyLocation,
  loadReduceMotion,
  loadUnit,
  loadWaterNames,
} from './storage.ts';

const EXPLICIT_DEFAULT_KEYS = ['follow', 'dayNight', 'clock'] as const;

export function explicitViewDefaults(view: Partial<LinkView>): LinkDefaultKey[] {
  return EXPLICIT_DEFAULT_KEYS.filter((key) => view[key] !== undefined);
}

export function linkViewDefaults(search: string): LinkDefaultKey[] {
  const params = new URLSearchParams(search.toLowerCase());
  const encoded = [...new URLSearchParams(search)].find(([key]) => key.toLowerCase() === 'itinerary')?.[1];
  const decoded = encoded ? decodeItineraryParam(encoded) : null;
  const view = decoded?.ok ? decoded.doc.view : undefined;
  return EXPLICIT_DEFAULT_KEYS.filter((key) => params.has(key.toLowerCase()) || view?.[key] !== undefined);
}

/** Miles apply only to an English interface in a miles-using region. */
export function defaultDistanceUnit(locale: string, language: string): DistanceUnit {
  return locale.startsWith('en') && /-(US|LR|MM)$/i.test(language) ? 'mi' : 'km';
}

export interface ViewPreferences {
  unit: DistanceUnit;
  showCountryNames: boolean;
  showWaterNames: boolean;
  showBorders: boolean;
  followAircraft: boolean;
  dayNight: boolean;
  clockZone: string;
  myLocation: boolean;
  reduceMotionPref: boolean | null;
  avoidAirspace: boolean;
}

export function loadViewPreferences(defaultUnit: DistanceUnit): ViewPreferences {
  const countryNames = loadCountryNames() ?? false;
  return {
    unit: loadUnit() ?? defaultUnit,
    showCountryNames: countryNames,
    showWaterNames: loadWaterNames() ?? countryNames,
    showBorders: loadBorders() ?? true,
    followAircraft: loadFollowAircraft() ?? false,
    dayNight: loadDayNight() ?? true,
    clockZone: loadClockZone() ?? 'local',
    myLocation: loadMyLocation() ?? false,
    reduceMotionPref: loadReduceMotion(),
    avoidAirspace: loadAvoidAirspace() ?? true,
  };
}

export function resolveViewPreferences(defaultUnit: DistanceUnit, view: LinkView, explicit: LinkDefaultKey[]) {
  const saved = loadViewPreferences(defaultUnit);
  return {
    ...saved,
    unit: view.units ?? saved.unit,
    showCountryNames: view.names ?? saved.showCountryNames,
    showWaterNames: view.names ?? saved.showWaterNames,
    showBorders: view.borders ?? saved.showBorders,
    followAircraft: explicit.includes('follow') ? view.follow : saved.followAircraft,
    dayNight: explicit.includes('dayNight') ? view.dayNight : saved.dayNight,
    clockZone: explicit.includes('clock') ? view.clock : saved.clockZone,
  };
}
