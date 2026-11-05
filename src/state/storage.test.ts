import { describe, it, expect, vi } from 'vitest';
import { loadBorders, loadLastRoute, loadUnit, saveBorders, saveLastRoute, saveUnit } from './storage.ts';
describe('safe storage', () => {
  it('round trips preferences with route caps and rejects malformed stored data', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    try {
      expect(loadUnit()).toBeNull();
      expect(loadLastRoute()).toBeNull();
      saveUnit('mi');
      expect(loadUnit()).toBe('mi');
      saveUnit('km');
      expect(loadUnit()).toBe('km');
      saveLastRoute(Array(15).fill('CPH'));
      expect(loadLastRoute()).toHaveLength(10);
      saveLastRoute(['CPH', 'LHR_180', 'JFK']);
      expect(loadLastRoute()).toEqual(['CPH', 'LHR_180', 'JFK']);
      expect(loadBorders()).toBeNull();
      saveBorders(false);
      expect(loadBorders()).toBe(false);
      saveBorders(true);
      expect(loadBorders()).toBe(true);
      data.set('globehops:borders', 'maybe');
      expect(loadBorders()).toBeNull();
      expect([...data.keys()].every((k) => k.startsWith('globehops:'))).toBe(true);
      data.set('globehops:unit', 'wrong');
      expect(loadUnit()).toBeNull();
      for (const bad of ['{', 'null', '[42]']) {
        data.set('globehops:lastRoute', bad);
        expect(loadLastRoute()).toBeNull();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('never throws when storage is unavailable or blocked', () => {
    for (const storage of [
      undefined,
      {
        getItem: () => {
          throw Error('blocked');
        },
        setItem: () => {
          throw Error('quota');
        },
      },
    ]) {
      vi.stubGlobal('localStorage', storage);
      try {
        expect(loadUnit()).toBeNull();
        expect(loadLastRoute()).toBeNull();
        expect(loadBorders()).toBeNull();
        expect(() => {
          saveUnit('km');
          saveBorders(false);
          saveLastRoute([]);
        }).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
