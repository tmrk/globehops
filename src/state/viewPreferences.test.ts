import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeItineraryParam } from '../agent/itinerary.ts';
import { parseLink } from './link.ts';
import {
  defaultDistanceUnit,
  explicitViewDefaults,
  linkViewDefaults,
  loadViewPreferences,
  resolveViewPreferences,
} from './viewPreferences.ts';

afterEach(() => vi.unstubAllGlobals());

function stored(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries).map(([key, value]) => [`globehops:${key}`, value]));
  const setItem = vi.fn((key: string, value: string) => data.set(key, value));
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem });
  return { data, setItem };
}

describe('view preferences', () => {
  it.each([
    ['en', 'en-US', 'mi'],
    ['en', 'en-LR', 'mi'],
    ['en', 'en-MM', 'mi'],
    ['en', 'en-GB', 'km'],
    ['hu', 'en-US', 'km'],
    ['sv', 'en-US', 'km'],
    ['en', '', 'km'],
  ])('defaults %s with browser language %s to %s', (locale, language, unit) => {
    expect(defaultDistanceUnit(locale, language)).toBe(unit);
  });

  it('defines defaults once and lets water names inherit the saved country choice', () => {
    const { data } = stored();
    expect(loadViewPreferences('mi')).toEqual({
      unit: 'mi',
      showCountryNames: false,
      showWaterNames: false,
      showBorders: true,
      followAircraft: false,
      dayNight: true,
      clockZone: 'local',
      myLocation: false,
      reduceMotionPref: null,
    });
    data.set('globehops:countryNames', 'on');
    expect(loadViewPreferences('km').showWaterNames).toBe(true);
    data.set('globehops:waterNames', 'off');
    expect(loadViewPreferences('km')).toMatchObject({ showCountryNames: true, showWaterNames: false });
  });

  it('applies and removes visit overrides without overwriting saved choices', () => {
    const { setItem } = stored({
      unit: 'mi',
      countryNames: 'off',
      waterNames: 'on',
      borders: 'on',
      followAircraft: 'on',
      daynight: 'off',
      clockZone: 'utc',
      reduceMotion: 'on',
      myLocation: 'on',
    });
    const search = '?names=1&borders=0&follow=0&daynight=1&clock=local&units=km';
    const linked = resolveViewPreferences('km', parseLink(search).view, linkViewDefaults(search));
    expect(linked).toMatchObject({
      unit: 'km',
      showCountryNames: true,
      showWaterNames: true,
      showBorders: false,
      followAircraft: false,
      dayNight: true,
      clockZone: 'local',
    });
    expect(resolveViewPreferences('km', parseLink('').view, [])).toMatchObject({
      unit: 'mi',
      showCountryNames: false,
      showWaterNames: true,
      showBorders: true,
      followAircraft: true,
      dayNight: false,
      clockZone: 'utc',
      myLocation: true,
      reduceMotionPref: true,
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('recognizes explicit defaults in case-insensitive query keys and encoded documents', () => {
    expect(linkViewDefaults('?FoLlOw=0&DayNight=1&CLOCK=local')).toEqual(['follow', 'dayNight', 'clock']);
    const encoded = encodeItineraryParam({
      version: 1,
      stops: [{ airport: 'CPH' }],
      view: { follow: false, dayNight: true, clock: 'local' },
    });
    expect(linkViewDefaults(`?ITINERARY=${encoded}`)).toEqual(['follow', 'dayNight', 'clock']);
    expect(linkViewDefaults('?itinerary=broken')).toEqual([]);
    expect(explicitViewDefaults({ follow: false, dayNight: true, clock: 'local', units: 'mi' })).toEqual([
      'follow',
      'dayNight',
      'clock',
    ]);
  });
});
