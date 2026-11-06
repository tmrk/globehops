import { describe, expect, it } from 'vitest';
import { analyticsAvailable, GA_HOSTS, parseConsent, reportedLocation } from './analytics.ts';

const live = { hostname: GA_HOSTS[0], production: true };

describe('analyticsAvailable', () => {
  it('is offered only on the production host in a production build', () => {
    expect(analyticsAvailable(live)).toBe(true);
    expect(analyticsAvailable({ ...live, production: false })).toBe(false);
    expect(analyticsAvailable({ ...live, hostname: 'localhost' })).toBe(false);
    expect(analyticsAvailable({ ...live, hostname: 'someone.github.io' })).toBe(false);
  });

  it('respects Global Privacy Control and Do Not Track', () => {
    expect(analyticsAvailable({ ...live, globalPrivacyControl: true })).toBe(false);
    expect(analyticsAvailable({ ...live, doNotTrack: '1' })).toBe(false);
    expect(analyticsAvailable({ ...live, doNotTrack: 'yes' })).toBe(false);
    expect(analyticsAvailable({ ...live, globalPrivacyControl: false, doNotTrack: '0' })).toBe(true);
    expect(analyticsAvailable({ ...live, doNotTrack: 'unspecified' })).toBe(true);
    expect(analyticsAvailable({ ...live, doNotTrack: null })).toBe(true);
  });
});

describe('parseConsent', () => {
  it('accepts only stored decisions', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
    expect(parseConsent('yes')).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });
});

describe('reportedLocation', () => {
  it('drops the itinerary query and fragment', () => {
    expect(
      reportedLocation(
        'https://tmrk.github.io/globehops/?route=CPH-LHR_180-JFK&dep1=2026-11-20T08:15&t=2026-11-20T10:00Z#x',
      ),
    ).toBe('https://tmrk.github.io/globehops/');
    expect(reportedLocation('https://tmrk.github.io/globehops/')).toBe('https://tmrk.github.io/globehops/');
  });

  it('strips locale directories as well as route queries', () => {
    for (const locale of ['en', 'hu', 'sv']) {
      expect(reportedLocation(`https://tmrk.github.io/globehops/${locale}/?route=CPH-LHR`)).toBe(
        'https://tmrk.github.io/globehops/',
      );
      expect(reportedLocation(`https://example.org/${locale}?t=private`)).toBe('https://example.org/');
    }
  });

  it('reports only the configured base even from a deeper path', () => {
    expect(reportedLocation('https://tmrk.github.io/globehops/hu/extra?route=private', '/globehops/')).toBe(
      'https://tmrk.github.io/globehops/',
    );
    expect(reportedLocation('https://example.org/sv/extra?t=private', '/')).toBe('https://example.org/');
  });

  it('reports nothing for an unparseable address', () => {
    expect(reportedLocation('not a url')).toBe('');
  });
});
