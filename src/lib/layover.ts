/**
 * Layover (connection) time at transfer airports. Every connection starts at a default the user
 * can change per stop; only changed values are stored in the route.
 */
export const DEFAULT_LAYOVER_MIN = 90;
/** Longest layover a URL or stored route may specify (one week). */
export const MAX_LAYOVER_MIN = 7 * 24 * 60;

/** Choices offered in the layover menu. */
export const LAYOVER_CHOICES: readonly number[] = [
  30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720, 960, 1440, 2160, 2880, 4320,
];

export function isValidLayover(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LAYOVER_MIN;
}

/** The menu choices, including a non-standard current value (e.g. from a shared link) in order. */
export function layoverChoices(current: number): number[] {
  return LAYOVER_CHOICES.includes(current) ? [...LAYOVER_CHOICES] : [...LAYOVER_CHOICES, current].sort((a, b) => a - b);
}

/** Compact layover label: "45m", "2h", "1h 30m", "1d", "1d 12h". */
export function formatLayover(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const parts = [days ? `${days}d` : '', hours ? `${hours}h` : '', mins ? `${mins}m` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0m';
}
