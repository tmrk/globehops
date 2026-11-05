import type { DistanceUnit } from '../types.ts';
const UNIT_KEY = 'globehops:unit',
  ROUTE_KEY = 'globehops:lastRoute',
  BORDERS_KEY = 'globehops:borders';
export function loadUnit(): DistanceUnit | null {
  try {
    const unit = globalThis.localStorage?.getItem(UNIT_KEY);
    return unit === 'km' || unit === 'mi' ? unit : null;
  } catch {
    return null;
  }
}
export function saveUnit(u: DistanceUnit): void {
  try {
    globalThis.localStorage?.setItem(UNIT_KEY, u);
  } catch {
    /* Storage may be disabled. */
  }
}
export function loadLastRoute(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(ROUTE_KEY);
    if (raw == null) return null;
    const codes: unknown = JSON.parse(raw);
    return Array.isArray(codes) && codes.every((c) => typeof c === 'string') ? codes.slice(0, 10) : null;
  } catch {
    return null;
  }
}
export function saveLastRoute(codes: string[]): void {
  try {
    globalThis.localStorage?.setItem(ROUTE_KEY, JSON.stringify(codes.slice(0, 10)));
  } catch {
    /* Quota/private-mode failures are harmless. */
  }
}
/** Country-border visibility; null when the user hasn't chosen (borders default to on). */
export function loadBorders(): boolean | null {
  try {
    const value = globalThis.localStorage?.getItem(BORDERS_KEY);
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch {
    return null;
  }
}
export function saveBorders(visible: boolean): void {
  try {
    globalThis.localStorage?.setItem(BORDERS_KEY, visible ? 'on' : 'off');
  } catch {
    /* Storage may be disabled. */
  }
}

const JOURNEY_KEY = 'globehops:lastJourney';
const DAY_NIGHT_KEY = 'globehops:daynight';
const CLOCK_ZONE_KEY = 'globehops:clockZone';
function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}
export function loadLastJourney(): string | null {
  const query = read(JOURNEY_KEY);
  return query !== null && query.length <= 4000 ? query : null;
}
export function saveLastJourney(query: string): void {
  if (query.length > 4000) return;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (['t', 'play', 'units'].includes(key.toLowerCase())) params.delete(key);
  const canonical = params.toString().replace(/%3A/gi, ':');
  const remembered = canonical ? `?${canonical}` : '';
  if (remembered.length <= 4000) write(JOURNEY_KEY, remembered);
}
export function loadDayNight(): boolean | null {
  const value = read(DAY_NIGHT_KEY);
  return value === 'on' ? true : value === 'off' ? false : null;
}
export function saveDayNight(on: boolean): void {
  write(DAY_NIGHT_KEY, on ? 'on' : 'off');
}
export function loadClockZone(): 'local' | 'utc' | null {
  const value = read(CLOCK_ZONE_KEY);
  return value === 'local' || value === 'utc' ? value : null;
}
export function saveClockZone(zone: 'local' | 'utc'): void {
  write(CLOCK_ZONE_KEY, zone);
}
