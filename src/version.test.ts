import { describe, expect, it } from 'vitest';
import { APP_VERSION, describeBuild } from './version.ts';

describe('build information', () => {
  it('exposes the package.json release version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('describes the commit and date when known', () => {
    expect(describeBuild('53dabe6', '2026-11-06')).toBe('Build 53dabe6, 6 Nov 2026');
    expect(describeBuild('53dabe6', '')).toBe('Build 53dabe6');
    expect(describeBuild('', '2026-11-06')).toBe('6 Nov 2026');
    expect(describeBuild('', 'not a date')).toBe('');
  });
});
