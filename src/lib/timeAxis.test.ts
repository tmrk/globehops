import { describe, expect, it } from 'vitest';
import { composedAxis } from './timeAxis.ts';

const H = 3_600_000;

describe('composed time axis', () => {
  it('is the identity in minutes without gaps', () => {
    const axis = composedAxis(0, 10 * H);
    expect(axis.length).toBe(600);
    expect(axis.breaks).toEqual([]);
    expect(axis.toPos(2 * H)).toBe(120);
    expect(axis.toTime(120)).toBe(2 * H);
    expect(axis.toPos(-H)).toBe(0);
    expect(axis.toPos(20 * H)).toBe(600);
  });

  it('compresses a five-day stay into a short break and inverts exactly', () => {
    // 14 h outbound, 5-day stay, 13 h return.
    const stay = { start: 14 * H, end: 14 * H + 120 * H };
    const axis = composedAxis(0, 14 * H + 120 * H + 13 * H, [stay]);
    const plain = (14 + 13) * 60;
    expect(axis.breaks).toEqual([{ start: stay.start, end: stay.end, pos: 14 * 60, width: 0.06 * plain }]);
    expect(axis.length).toBeCloseTo(plain * 1.06, 9);
    // Flights keep their true scale on either side of the break.
    expect(axis.toPos(H)).toBe(60);
    expect(axis.toPos(stay.end + H)).toBeCloseTo(14 * 60 + 0.06 * plain + 60, 9);
    for (const t of [0, 3 * H, stay.start, stay.start + 60 * H, stay.end, stay.end + 5 * H]) {
      expect(axis.toTime(axis.toPos(t))).toBeCloseTo(t, 3);
    }
    // Monotonic.
    let previous = -1;
    for (let t = 0; t <= axis.end; t += H) {
      const p = axis.toPos(t);
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });

  it('keeps a minimum break width, clips gaps to the range and ignores overlaps', () => {
    const axis = composedAxis(0, 2 * H, [
      { start: H, end: 5 * H },
      { start: 1.5 * H, end: 1.8 * H },
      { start: -H, end: 0 },
    ]);
    expect(axis.breaks).toHaveLength(1);
    expect(axis.breaks[0]).toMatchObject({ start: H, end: 2 * H, width: 30 });
  });
});
