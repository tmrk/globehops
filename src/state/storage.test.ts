import { describe, it, expect, vi } from 'vitest';
import {
  loadBorders,
  loadCountryNames,
  saveCountryNames,
  loadLastRoute,
  loadUnit,
  saveBorders,
  saveLastRoute,
  saveUnit,
  loadLastJourney,
  saveLastJourney,
  loadDayNight,
  saveDayNight,
  loadClockZone,
  saveClockZone,
} from './storage.ts';
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
      expect(loadCountryNames()).toBeNull();
      saveCountryNames(true);
      expect(loadCountryNames()).toBe(true);
      expect(data.get('globehops:countryNames')).toBe('on');
      saveCountryNames(false);
      expect(loadCountryNames()).toBe(false);
      expect(data.get('globehops:countryNames')).toBe('off');
      data.set('globehops:countryNames', 'maybe');
      expect(loadCountryNames()).toBeNull();
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
        expect(loadCountryNames()).toBeNull();
        expect(() => {
          saveUnit('km');
          saveBorders(false);
          saveCountryNames(true);
          saveLastRoute([]);
        }).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});

describe('journey preferences', () => {
  it('round trips day/night, clock zone and a capped remembered journey without transient view params', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    try {
      expect(loadLastJourney()).toBeNull();
      expect(loadDayNight()).toBeNull();
      expect(loadClockZone()).toBeNull();
      const query = '?route=CPH-LHR&dep1=2026-11-20T08:15%2B01:00&speed=3600&clock=utc&daynight=0';
      saveLastJourney(`${query}&t=2026-11-20T09:30Z&play=1&units=mi`);
      expect(loadLastJourney()).toBe(query);
      saveLastJourney('?route=' + 'A'.repeat(4000));
      expect(loadLastJourney()).toBe(query);
      data.set('globehops:lastJourney', 'x'.repeat(4001));
      expect(loadLastJourney()).toBeNull();
      saveLastJourney('');
      expect(loadLastJourney()).toBe('');
      data.set('globehops:lastJourney', '?' + 'x'.repeat(3999));
      expect(loadLastJourney()?.length).toBe(4000);
      saveDayNight(false);
      expect(loadDayNight()).toBe(false);
      saveDayNight(true);
      expect(loadDayNight()).toBe(true);
      data.set('globehops:daynight', 'maybe');
      expect(loadDayNight()).toBeNull();
      saveClockZone('utc');
      expect(loadClockZone()).toBe('utc');
      saveClockZone('local');
      expect(loadClockZone()).toBe('local');
      data.set('globehops:clockZone', 'CPH');
      expect(loadClockZone()).toBeNull();
      saveLastRoute(['CPH', 'LHR']);
      expect(loadLastRoute()).toEqual(['CPH', 'LHR']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('handles blocked or absent storage for every new preference', () => {
    for (const localStorage of [
      undefined,
      {
        getItem: () => {
          throw Error('blocked');
        },
        setItem: () => {
          throw Error('blocked');
        },
      },
    ]) {
      vi.stubGlobal('localStorage', localStorage);
      try {
        expect(loadLastJourney()).toBeNull();
        expect(loadDayNight()).toBeNull();
        expect(loadClockZone()).toBeNull();
        expect(() => {
          saveLastJourney('?route=CPH-LHR');
          saveDayNight(false);
          saveClockZone('utc');
        }).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
