/**
 * A scrubber axis that shows long stays compressed: flights and connections keep their true
 * proportions, while each stay takes a short fixed span marked as a break. Positions are "axis
 * minutes", so keyboard steps on a range input move one real minute through flights and connections.
 */
export interface AxisBreak {
  /** Real UTC instants of the compressed interval. */
  start: number;
  end: number;
  /** Axis position and width (axis minutes). */
  pos: number;
  width: number;
}
export interface TimeAxis {
  start: number;
  end: number;
  /** Total axis length (axis minutes). */
  length: number;
  breaks: AxisBreak[];
  toPos(time: number): number;
  toTime(pos: number): number;
}

const MIN = 60_000;

/**
 * `gaps` are real intervals inside [start, end] to compress (sorted, non-overlapping are not required).
 * Each takes `share` of the uncompressed time's length, at least `minWidth` axis minutes.
 */
export function composedAxis(
  start: number,
  end: number,
  gaps: readonly { start: number; end: number }[] = [],
  share = 0.06,
  minWidth = 30,
): TimeAxis {
  const clipped = gaps
    .map((gap) => ({ start: Math.max(start, gap.start), end: Math.min(end, gap.end) }))
    .filter((gap) => gap.end > gap.start)
    .sort((a, b) => a.start - b.start)
    .filter((gap, i, all) => i === 0 || gap.start >= all[i - 1].end);
  const compressed = clipped.reduce((sum, gap) => sum + gap.end - gap.start, 0);
  const plain = Math.max(0, end - start - compressed) / MIN;
  const width = Math.max(minWidth, share * plain);
  // Knots map real instants to axis positions; linear between them.
  const times = [start];
  const positions = [0];
  const breaks: AxisBreak[] = [];
  let pos = 0;
  let at = start;
  for (const gap of clipped) {
    pos += (gap.start - at) / MIN;
    times.push(gap.start);
    positions.push(pos);
    breaks.push({ start: gap.start, end: gap.end, pos, width });
    pos += width;
    times.push(gap.end);
    positions.push(pos);
    at = gap.end;
  }
  pos += (end - at) / MIN;
  times.push(end);
  positions.push(pos);
  const locate = (values: number[], value: number) => {
    let lo = 0,
      hi = values.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (values[mid] <= value) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const interpolate = (from: number[], to: number[], value: number) => {
    if (value <= from[0]) return to[0];
    if (value >= from[from.length - 1]) return to[to.length - 1];
    const i = locate(from, value);
    const span = from[i + 1] - from[i];
    return span > 0 ? to[i] + ((value - from[i]) / span) * (to[i + 1] - to[i]) : to[i + 1];
  };
  return {
    start,
    end,
    length: pos,
    breaks,
    toPos: (time) => interpolate(times, positions, time),
    toTime: (p) => interpolate(positions, times, p),
  };
}
