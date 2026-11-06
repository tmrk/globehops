import { describe, expect, it } from 'vitest';
import { uiFormatters } from './uiFormat.ts';
import { translator } from './catalogue.ts';
import { en } from './messages/en.ts';
import { hu } from './messages/hu.ts';
import { sv } from './messages/sv.ts';
import { computeJourney } from '../lib/schedule.ts';
import { describeState, clockZoneOptions } from '../lib/journeyText.ts';
import { buildTimeline, journeyStateAt } from '../lib/timeline.ts';
import { describeBuild } from '../version.ts';
import type { Airport } from '../types.ts';
const airport = (id: number, code: string, city: string, zone: string, local: string | null) => ({
  airport: {
    id,
    ident: code,
    iata: code,
    icao: null,
    name: `${city} Airport`,
    city,
    region: '',
    countryCode: 'SE',
    country: 'Sweden',
    lat: id,
    lng: 0,
    type: 'large',
    scheduled: true,
    keywords: [],
  } as Airport,
  zone,
  arrival: null,
  departure: local ? { local, offsetMin: null } : null,
  layoverMin: null,
});
const journey = computeJourney({
  id: 'test',
  stops: [
    airport(1, 'CPH', 'Copenhagen', 'Europe/Copenhagen', '2026-11-20T08:15'),
    airport(2, 'LHR', 'London Heathrow', 'Europe/London', null),
  ],
});
describe('UI wording from structured journey data', () => {
  it('routes places, statuses, clock options and issue captions through the city seam', () => {
    const fmt = uiFormatters('hu', translator(hu), () => 'Helynév');
    expect(fmt.city(journey.stops[0].airport)).toBe('Helynév');
    expect(fmt.place(journey.stops[0].airport)).toContain('Helynév');
    expect(fmt.describeState(journey, { phase: 'after', stop: 1, leg: 0 }).title).toContain('Helynév');
    expect(fmt.clockZoneOptions(journey, 'UTC').at(-1)?.label).toContain('Helynév');
    expect(fmt.issue({ code: 'invalid_time', severity: 'error', message: 'English', stop: 0 }, journey)).toContain(
      'Helynév',
    );
  });
  it('keeps established English statuses, clock options and build wording', () => {
    const fmt = uiFormatters('en', translator(en));
    const timeline = buildTimeline(journey)!;
    for (const time of [timeline.start - 1, timeline.start + 1, timeline.end]) {
      const state = journeyStateAt(journey, timeline, time);
      expect(fmt.describeState(journey, state)).toEqual(describeState(journey, state));
    }
    expect(fmt.clockZoneOptions(journey, 'Europe/Stockholm')).toEqual(clockZoneOptions(journey, 'Europe/Stockholm'));
    for (const [commit, date] of [
      ['abc1234', '2026-11-06'],
      ['', ''],
      ['abc1234', ''],
      ['', '2026-11-06'],
    ])
      expect(fmt.build(commit, date)).toBe(describeBuild(commit, date));
  });
  for (const [locale, messages] of [
    ['hu', hu],
    ['sv', sv],
  ] as const)
    it(`translates issues from codes without changing shared English output in ${locale}`, () => {
      const invalid = computeJourney({
        id: 'invalid',
        stops: [
          airport(1, 'JFK', 'New York', 'America/New_York', '2026-03-08T02:30'),
          airport(2, 'LHR', 'London', 'Europe/London', null),
        ],
      });
      const issue = invalid.issues.find((item) => item.code === 'nonexistent_local_time')!;
      expect(issue.message).toContain("doesn't exist");
      const original = JSON.stringify(invalid);
      const fmt = uiFormatters(locale, translator(messages));
      const text = fmt.issue(issue, invalid);
      expect(text).toContain('New York');
      expect(text).toContain(messages['issues.nonexistent_local_time']);
      expect(text).not.toContain("doesn't exist");
      expect(JSON.stringify(invalid)).toBe(original);
      expect(fmt.stopPlaceholder(0, 2)).toBe(messages['stops.whereFrom']);
      expect(fmt.stopLabel(1, 3)).toContain('1');
      expect(fmt.describeState(journey, { phase: 'after', stop: 1, leg: 0 }).detail).toBe(messages['journey.complete']);
    });
});
