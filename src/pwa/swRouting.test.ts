import { describe, expect, it } from 'vitest';
import { navigationCacheUrl, scopedGet } from './swRouting.ts';

describe('worker routing under any deployment base', () => {
  for (const base of ['/', '/globehops/', '/nested/custom/']) {
    const scope = `https://example.com${base}`;
    it(`ignores journey queries and maps only known pages under ${base}`, () => {
      for (const path of ['', 'index.html']) {
        expect(navigationCacheUrl(`${scope}${path}?route=CPH-LHR&b.route=JFK-LAX&lang=sv`, scope)).toBe(scope);
      }
      for (const locale of ['en', 'hu', 'sv']) {
        for (const suffix of ['', '/', '/index.html']) {
          expect(navigationCacheUrl(`${scope}${locale}${suffix}?route=CPH-LHR`, scope)).toBe(`${scope}${locale}/`);
        }
      }
      for (const path of ['unknown', 'hu/unknown', 'assets/app.js', 'hus']) {
        expect(navigationCacheUrl(`${scope}${path}`, scope)).toBeNull();
      }
      expect(navigationCacheUrl(`https://other.com${base}hu/`, scope)).toBeNull();
    });
    it(`passes through cross origin, out of scope, Range and non-GET requests under ${base}`, () => {
      expect(scopedGet(`${scope}assets/app.js`, scope, 'GET', false)).toBe(true);
      expect(scopedGet(`${scope}assets/app.js`, scope, 'GET', true)).toBe(false);
      expect(scopedGet(scope, scope, 'POST', false)).toBe(false);
      expect(scopedGet('https://analytics.example.com/', scope, 'GET', false)).toBe(false);
      if (base !== '/') expect(scopedGet('https://example.com/outside', scope, 'GET', false)).toBe(false);
    });
  }
});
