import { expect, it } from 'vitest';
import { parseLink } from './link.ts';
import { extractLinkQuery } from './sharedLink.ts';

it.each([
  '?route=CPH-LHR',
  'route=CPH-LHR',
  '#?route=CPH-LHR',
  '#route=CPH-LHR',
  'https://globehops.marki.im/?route=CPH-LHR',
  'https://globehops.marki.im/hu/?route=CPH-LHR',
  'https://globehops.marki.im/en?route=CPH-LHR',
  'https://globehops.marki.im/sv/?route=CPH-LHR',
  'https://tmrk.github.io/globehops/?route=CPH-LHR',
  'https://tmrk.github.io/globehops/sv/?route=CPH-LHR',
  'https://globehops.marki.im/globehops/?route=CPH-LHR',
  'Look: https://globehops.marki.im/?route=CPH-LHR !',
  '<https://globehops.marki.im/?route=CPH-LHR>.',
  '(https://globehops.marki.im/?route=CPH-LHR).',
  'https://globehops.marki.im/#?route=CPH-LHR',
])('accepts %s', (input) => expect(extractLinkQuery(input)).toBe('?route=CPH-LHR'));

it('accepts only the running origin and its app pages, including a subpath', () => {
  const options = { origin: 'http://localhost:5173', base: '/nested/app/' };
  expect(extractLinkQuery('http://localhost:5173/nested/app/hu/?route=CPH-LHR', options)).toBe('?route=CPH-LHR');
  expect(extractLinkQuery('http://localhost:5173/?route=CPH-LHR', options)).toBeNull();
  expect(
    extractLinkQuery('https://abc.globehops.pages.dev/?route=CPH-LHR', { origin: 'https://abc.globehops.pages.dev' }),
  ).toBe('?route=CPH-LHR');
});

it.each([
  'https://example.com/?route=CPH-LHR',
  'https://globehops.marki.im.example.com/?route=CPH-LHR',
  'https://globehops.marki.im/other/?route=CPH-LHR',
  'https://tmrk.github.io/?route=CPH-LHR',
  'https://tmrk.github.io/another/?route=CPH-LHR',
  'CPH LHR',
  'CPH-LHR',
  '?route=',
  '?play=1',
  'https://globehops.marki.im/?play=1',
  'https://[invalid/?route=CPH-LHR',
  '',
])('rejects %s', (input) => expect(extractLinkQuery(input)).toBeNull());

it('preserves playback and view, removes only language, and decodes encoded labels exactly once', () => {
  const result = extractLinkQuery(
    '?route=CPH-LHR&label=A+%26+B%20%2B+C&dep1=2026-11-14T09%3A00&lang=hu&play=1&speed=1800&t=2026-11-14T09:00Z&follow=1',
  );
  expect(new URLSearchParams(result!).get('label')).toBe('A & B + C');
  expect(new URLSearchParams(result!).has('lang')).toBe(false);
  expect(parseLink(result!).view).toMatchObject({ play: true, speed: 1800, follow: true });
  expect(extractLinkQuery('?route=CPH-LHR&label=My+trip')).toBe(extractLinkQuery('?route=CPH-LHR&label=My%20trip'));
});

it('bounds scanning and rejects oversized link queries', () => {
  expect(extractLinkQuery('x'.repeat(65536) + ' https://globehops.marki.im/?route=CPH-LHR')).toBeNull();
  expect(extractLinkQuery('?route=CPH-LHR&label=' + 'x'.repeat(100000))).toBeNull();
  expect(extractLinkQuery('https://globehops.marki.im/?route=CPH-LHR ' + 'x'.repeat(100000))).toBe('?route=CPH-LHR');
});

it('skips malformed URLs while looking for a later valid link', () => {
  expect(extractLinkQuery('https://[broken Look https://globehops.marki.im/?route=CPH-LHR')).toBe('?route=CPH-LHR');
  expect(extractLinkQuery('?ROUTE=CPH-LHR&LANG=sv')).toBe('?ROUTE=CPH-LHR');
  expect(extractLinkQuery('http://globehops.marki.im/?route=CPH-LHR')).toBe('?route=CPH-LHR');
});
