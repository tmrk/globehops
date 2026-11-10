import type { TrackPoint } from '../track.ts';
import { greatCircleDistanceKm } from '../geo.ts';
import type { ParsedPath } from './types.ts';
import type { ParseState } from './common.ts';

export function validateTimes(path: ParsedPath, state: ParseState): void {
  let previous = -Infinity,
    unordered = 0,
    timed = 0;
  for (const p of path.points) {
    if (p.time === null) continue;
    if (p.time < previous) {
      p.time = null;
      unordered++;
    } else {
      previous = p.time;
      timed++;
    }
  }
  if (unordered)
    state.warn('times_unordered', `${unordered} timestamps went backwards and were dropped.`, { count: unordered });
  path.kind ??= timed >= 2 ? 'recorded' : 'planned';
  if (path.kind === 'recorded' && timed < path.points.length)
    state.warn('times_partial', 'Some recorded points have no timestamp.');
}
/** Linear scan. Every original point belongs to exactly one output; no endpoint is duplicated. */
export function splitRecorded(points: TrackPoint[]): TrackPoint[][] {
  const cuts: number[] = [];
  let start = 0,
    phaseStart = -1,
    low = Infinity,
    high = -Infinity;
  const addCut = (cut: number) => {
    if (cut - start >= 2 && points.length - cut >= 2) {
      cuts.push(cut);
      start = cut;
    }
  };
  const finishPhase = (end: number) => {
    if (phaseStart <= start || end >= points.length - 1) return;
    const firstTime = points[phaseStart].time,
      lastTime = points[end].time;
    if (firstTime !== null && lastTime !== null && lastTime - firstTime >= 600_000)
      addCut(Math.floor((phaseStart + end + 1) / 2));
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dt = a.time !== null && b.time !== null ? b.time - a.time : 0;
    const km = greatCircleDistanceKm(a, b);
    if (dt >= 1_200_000 && km <= 25) {
      addCut(i);
      phaseStart = -1;
      low = Infinity;
      high = -Infinity;
      continue;
    }
    const slow = dt > 0 && (km / dt) * 3_600_000 < 50;
    if (!slow) {
      finishPhase(i - 1);
      phaseStart = -1;
      low = Infinity;
      high = -Infinity;
      continue;
    }
    if (phaseStart < 0) {
      phaseStart = i - 1;
      low = a.altM ?? Infinity;
      high = a.altM ?? -Infinity;
    }
    if (b.altM !== null) {
      low = Math.min(low, b.altM);
      high = Math.max(high, b.altM);
    }
    if (high - low > 150) {
      finishPhase(i - 1);
      phaseStart = i;
      low = b.altM ?? Infinity;
      high = b.altM ?? -Infinity;
    }
  }
  const result: TrackPoint[][] = [];
  start = 0;
  for (const cut of cuts) {
    result.push(points.slice(start, cut));
    start = cut;
  }
  result.push(points.slice(start));
  return result;
}
