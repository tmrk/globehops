import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYOVER_MIN,
  formatLayover,
  isValidLayover,
  LAYOVER_CHOICES,
  layoverChoices,
  MAX_LAYOVER_MIN,
} from './layover.ts';

describe('layovers', () => {
  it('offers the default among ascending choices', () => {
    expect(LAYOVER_CHOICES).toContain(DEFAULT_LAYOVER_MIN);
    expect([...LAYOVER_CHOICES].sort((a, b) => a - b)).toEqual(LAYOVER_CHOICES);
    expect(LAYOVER_CHOICES.every(isValidLayover)).toBe(true);
  });

  it('adds a non-standard current value in order without duplicating standard ones', () => {
    expect(layoverChoices(90)).toEqual(LAYOVER_CHOICES);
    const custom = layoverChoices(100);
    expect(custom).toHaveLength(LAYOVER_CHOICES.length + 1);
    expect(custom[custom.indexOf(100) - 1]).toBe(90);
    expect(custom[custom.indexOf(100) + 1]).toBe(120);
  });

  it('validates whole minutes up to a week', () => {
    for (const ok of [0, 1, 90, MAX_LAYOVER_MIN]) expect(isValidLayover(ok)).toBe(true);
    for (const bad of [-1, 1.5, MAX_LAYOVER_MIN + 1, Number.NaN, '90', null]) expect(isValidLayover(bad)).toBe(false);
  });

  it('formats compact durations', () => {
    for (const [n, text] of [
      [0, '0m'],
      [45, '45m'],
      [60, '1h'],
      [90, '1h 30m'],
      [120, '2h'],
      [1440, '1d'],
      [2160, '1d 12h'],
      [1505, '1d 1h 5m'],
    ] as const)
      expect(formatLayover(n)).toBe(text);
  });
});
