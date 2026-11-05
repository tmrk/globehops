import type { DistanceUnit } from '../types.ts';
const UNIT_KEY = 'globehops:unit',
  ROUTE_KEY = 'globehops:lastRoute';
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
