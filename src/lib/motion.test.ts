import { expect, it } from 'vitest';
import { effectiveReducedMotion } from './motion.ts';

it.each([
  [null, false, false],
  [null, true, true],
  [true, false, true],
  [true, true, true],
  [false, false, false],
  [false, true, false],
] as const)('saved %s, system %s yields %s', (saved, system, expected) => {
  expect(effectiveReducedMotion(saved, system)).toBe(expected);
});
