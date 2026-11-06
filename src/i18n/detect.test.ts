import { describe, expect, it } from 'vitest';
import { localeFromPath, localizedPath, resolveLocale, stripLocalePath } from './detect.ts';
const input = {
  pathname: '/globehops/',
  search: '',
  base: '/globehops/',
  stored: null,
  languages: [],
  timeZone: 'UTC',
};
describe('locale precedence', () => {
  it('prefers path, query, explicit choice, country, browser, then English', () => {
    const all = {
      ...input,
      pathname: '/globehops/sv/',
      search: '?lang=hu',
      stored: 'en',
      timeZone: 'Europe/Budapest',
      languages: ['sv-SE'],
    };
    expect(resolveLocale(all)).toEqual({ locale: 'sv', source: 'path' });
    expect(resolveLocale({ ...all, pathname: '/globehops/' })).toEqual({ locale: 'hu', source: 'query' });
    expect(resolveLocale({ ...all, pathname: '/globehops/', search: '' })).toEqual({ locale: 'en', source: 'stored' });
    expect(resolveLocale({ ...input, timeZone: 'Europe/Budapest', languages: ['en-GB'] })).toEqual({
      locale: 'hu',
      source: 'country',
    });
    expect(resolveLocale({ ...input, timeZone: 'Europe/Stockholm', languages: ['hu-HU'] })).toEqual({
      locale: 'sv',
      source: 'country',
    });
    expect(resolveLocale({ ...input, languages: ['fr-FR', 'en-US', 'hu-HU'] })).toEqual({
      locale: 'en',
      source: 'browser',
    });
    expect(resolveLocale(input)).toEqual({ locale: 'en', source: 'default' });
  });
  it('ignores invalid choices and accepts browser language subtags case insensitively', () => {
    expect(resolveLocale({ ...input, search: '?lang=fr', stored: 'de', languages: ['fr', 'SV-se'] })).toEqual({
      locale: 'sv',
      source: 'browser',
    });
    expect(resolveLocale({ ...input, languages: ['hu'] }).locale).toBe('hu');
    expect(resolveLocale({ ...input, languages: ['sv-FI'] }).locale).toBe('sv');
  });
});
describe.each(['/', '/globehops/', '/globehops'])('locale paths with base %s', (base) => {
  const root = base === '/' ? '/' : '/globehops/';
  it('recognises exact locale segments with and without trailing slashes', () => {
    for (const locale of ['en', 'hu', 'sv'] as const) {
      expect(localizedPath(base, locale)).toBe(`${root}${locale}/`);
      for (const tail of ['', '/', '/more/']) {
        expect(localeFromPath(`${root}${locale}${tail}`, base)).toBe(locale);
        expect(stripLocalePath(`${root}${locale}${tail}`, base)).toBe(root + tail.replace(/^\//, ''));
      }
    }
    expect(localizedPath(base, null)).toBe(root);
    for (const path of [root, `${root}fr/`, `${root}svenska/`, `${root}hu-other/`, '/another/hu/']) {
      expect(localeFromPath(path, base)).toBeNull();
      expect(stripLocalePath(path, base)).toBe(path);
    }
  });
});
