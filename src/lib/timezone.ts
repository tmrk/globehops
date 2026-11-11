export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;
const MINUTE = 60_000;
const DAY = 86_400_000;
const supportedZones = new Map<string, boolean>();
/**
 * Formatters by options object, then zone, then locale. Clocks format every animation frame, so the options
 * are shared constants (looked up by identity) rather than literals that would need a computed key.
 */
const formatters = new WeakMap<Intl.DateTimeFormatOptions, Map<string, Map<string, Intl.DateTimeFormat>>>();
const NO_OPTIONS: Intl.DateTimeFormatOptions = {};
const DATE_TIME_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};
const ZONE_NAME: Intl.DateTimeFormatOptions = { timeZoneName: 'short' };
const HOURS_MINUTES: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

function formatter(zone: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let byZone = formatters.get(options);
  if (!byZone) formatters.set(options, (byZone = new Map()));
  let byLocale = byZone.get(zone);
  if (!byLocale) byZone.set(zone, (byLocale = new Map()));
  let cached = byLocale.get(locale);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone, hourCycle: 'h23' });
    byLocale.set(locale, cached);
  }
  return cached;
}

/** Interpret calendar fields as UTC, including years 0–99 (which Date.UTC would reinterpret). */
function wallEpoch(l: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(l.year, l.month - 1, l.day);
  date.setUTCHours(l.hour, l.minute, 0, 0);
  return date.getTime();
}

function validLocal(l: LocalDateTime): boolean {
  if (
    ![l.year, l.month, l.day, l.hour, l.minute].every(Number.isInteger) ||
    l.hour < 0 ||
    l.hour > 23 ||
    l.minute < 0 ||
    l.minute > 59
  )
    return false;
  const date = new Date(wallEpoch(l));
  return date.getUTCFullYear() === l.year && date.getUTCMonth() + 1 === l.month && date.getUTCDate() === l.day;
}

export function parseLocalDateTime(s: string): LocalDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/.exec(s);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const local = { year: +year, month: +month, day: +day, hour: +hour, minute: +minute };
  // Range policy belongs to the caller; a valid date outside MIN_YEAR..MAX_YEAR is still parseable.
  return validLocal(local) ? local : null;
}

export function parseLocalDate(s: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const local = parseLocalDateTime(`${s}T00:00`);
  return local ? { year: local.year, month: local.month, day: local.day } : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function formatLocalDateTime(l: LocalDateTime): string {
  return `${pad(l.year, 4)}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
}

export function isSupportedTimeZone(zone: string): boolean {
  const cached = supportedZones.get(zone);
  if (cached !== undefined) return cached;
  try {
    formatter(zone, 'en-GB', NO_OPTIONS);
    supportedZones.set(zone, true);
    return true;
  } catch {
    supportedZones.set(zone, false);
    return false;
  }
}

function localParts(zone: string, epochMs: number): LocalDateTime & { second: number } {
  const parts = formatter(zone, 'en-GB-u-ca-gregory-nu-latn', DATE_TIME_PARTS).formatToParts(epochMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    // Some historical ICU versions emitted 24 even with h23. It means midnight on the printed date.
    hour: value('hour') % 24,
    minute: value('minute'),
    second: value('second'),
  };
}

function partsOffset(parts: LocalDateTime & { second: number }, epochMs: number): number {
  // Preserve historical sub-minute offsets; discard only the instant's unformatted milliseconds.
  return (wallEpoch(parts) + parts.second * 1000 - Math.floor(epochMs / 1000) * 1000) / MINUTE;
}

export function offsetMinutesAt(zone: string, epochMs: number): number {
  return partsOffset(localParts(zone, epochMs), epochMs);
}

export function utcToLocal(zone: string, epochMs: number): LocalDateTime & { offsetMin: number } {
  const parts = localParts(zone, epochMs);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    offsetMin: partsOffset(parts, epochMs),
  };
}

export interface ResolvedTime {
  epochMs: number;
  offsetMin: number;
}

export type LocalResolution =
  | { kind: 'exact'; time: ResolvedTime }
  | { kind: 'ambiguous'; options: [ResolvedTime, ResolvedTime] }
  | { kind: 'nonexistent'; before: ResolvedTime; after: ResolvedTime; gapMin: number };

export function resolveLocal(zone: string, local: LocalDateTime): LocalResolution {
  if (!validLocal(local)) throw new RangeError('Invalid local date and time');
  const wall = wallEpoch(local);
  const radius = 36 * 60 * MINUTE;
  const offsets = new Set([wall - radius, wall, wall + radius].map((t) => offsetMinutesAt(zone, t)));
  const candidates = [...offsets]
    .map((offsetMin) => ({ epochMs: wall - offsetMin * MINUTE, offsetMin }))
    .filter((t) => offsetMinutesAt(zone, t.epochMs) === t.offsetMin)
    .sort((a, b) => a.epochMs - b.epochMs);
  if (candidates.length === 1) return { kind: 'exact', time: candidates[0] };
  if (candidates.length === 2) return { kind: 'ambiguous', options: [candidates[0], candidates[1]] };

  let lo = wall - radius;
  let hi = wall + radius;
  const beforeOffset = offsetMinutesAt(zone, lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinutesAt(zone, mid) === beforeOffset) lo = mid;
    else hi = mid;
  }
  const afterOffset = offsetMinutesAt(zone, hi);
  // Both edges share the transition instant. With the old offset it labels the excluded
  // lower wall boundary (02:00 EST); with the new offset the included upper one (03:00 EDT).
  // Do not utcToLocal(before.epochMs) to label the old edge: use its attached offset.
  return {
    kind: 'nonexistent',
    before: { epochMs: hi, offsetMin: beforeOffset },
    after: { epochMs: hi, offsetMin: afterOffset },
    gapMin: afterOffset - beforeOffset,
  };
}

/** The instant a wall-clock time names: the earlier of a repeated hour, the first after a skipped one. */
export function epochAtLocal(zone: string, local: LocalDateTime): number {
  const resolution = resolveLocal(zone, local);
  if (resolution.kind === 'exact') return resolution.time.epochMs;
  return resolution.kind === 'ambiguous' ? resolution.options[0].epochMs : resolution.after.epochMs;
}

function offsetFields(offsetMin: number): { hours: number; minutes: number; seconds: number } {
  const seconds = Math.round(Math.abs(offsetMin) * 60);
  return { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60), seconds: seconds % 60 };
}

export function formatOffset(offsetMin: number): string {
  if (offsetMin === 0) return 'UTC';
  const { hours, minutes, seconds } = offsetFields(offsetMin);
  const tail = minutes || seconds ? `:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ''}` : '';
  return `UTC${offsetMin < 0 ? '−' : '+'}${hours}${tail}`;
}

export function formatIsoOffset(offsetMin: number): string {
  const { hours, minutes, seconds } = offsetFields(offsetMin);
  return `${offsetMin < 0 ? '-' : '+'}${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ''}`;
}

export function zoneAbbreviation(zone: string, epochMs: number): string {
  // ICU's short names depend on locale: en-GB has CET, en-US has EDT.
  for (const locale of ['en-GB', 'en-US']) {
    const name = formatter(zone, locale, ZONE_NAME)
      .formatToParts(epochMs)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^(?:GMT|UTC)[+−-]/.test(name)) return name;
  }
  return formatOffset(offsetMinutesAt(zone, epochMs));
}

export function parseIsoInstant(s: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (!match) return null;
  const local = parseLocalDateTime(match[1]);
  const seconds = Number(match[2] ?? 0);
  const hours = Number(match[5] ?? 0);
  const minutes = Number(match[6] ?? 0);
  if (!local || seconds > 59 || hours > 23 || minutes > 59) return null;
  const offset = (hours * 60 + minutes) * (match[4] === '-' ? -1 : 1);
  return wallEpoch(local) + seconds * 1000 - offset * MINUTE;
}

export function formatIsoInstant(epochMs: number): string {
  const iso = new Date(epochMs).toISOString().slice(0, 19);
  return `${iso.endsWith(':00') ? iso.slice(0, 16) : iso}Z`;
}

export function formatClock(
  epochMs: number,
  zone: string,
  opts: { weekday?: boolean; date?: boolean; locale?: string } = {},
): string {
  const locale = opts.locale ?? 'en-GB';
  const clock = formatter(zone, locale, HOURS_MINUTES)
    .formatToParts(epochMs)
    .map((part) => (part.type === 'hour' && part.value === '24' ? '00' : part.value))
    .join('');
  const prefix = [
    opts.weekday ? formatter(zone, locale, WEEKDAY).format(epochMs) : '',
    opts.date ? formatter(zone, locale, DAY_MONTH).format(epochMs) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return prefix ? `${prefix}, ${clock}` : clock;
}

export function localDayDifference(a: LocalDateTime, b: LocalDateTime): number {
  return (wallEpoch({ ...b, hour: 0, minute: 0 }) - wallEpoch({ ...a, hour: 0, minute: 0 })) / DAY;
}

let deviceZone: { zone: string; readAt: number } | null = null;
/**
 * The device's time zone. Clocks ask for it every animation frame, so it is read again (building a
 * formatter) at most once a second; a zone changed in the system settings still shows up promptly.
 */
export function browserTimeZone(): string {
  const now = Date.now();
  if (!deviceZone || Math.abs(now - deviceZone.readAt) >= 1000)
    deviceZone = { zone: new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', readAt: now };
  return deviceZone.zone;
}
