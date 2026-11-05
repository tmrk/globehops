import { describe, it, expect } from 'vitest';
import { convertDistance, formatDistance, formatDistanceNumber, KM_PER_MILE, roundDistance } from './units.ts';
describe('distances', () => {
  it('converts international statute miles and rounds after conversion', () => {
    expect(convertDistance(KM_PER_MILE, 'mi')).toBe(1);
    expect(convertDistance(42, 'km')).toBe(42);
    expect(roundDistance(999.4)).toBe(999);
    expect(roundDistance(1005)).toBe(1010);
    expect(formatDistance(5544, 'km')).toBe('5,540 km');
    expect(formatDistance(5540, 'mi')).toBe('3,440 mi');
    expect(formatDistance(0, 'km')).toBe('0 km');
    expect(formatDistanceNumber(5544, 'km', 'de-DE')).toBe('5.540');
  });
});
