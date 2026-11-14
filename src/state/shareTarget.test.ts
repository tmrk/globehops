import { expect, it } from 'vitest';
import { readShareTarget } from './shareTarget.ts';
import { setPendingShare, takePendingShare } from './pendingShare.ts';
const search = (values: Record<string, string>) => '?' + new URLSearchParams(values).toString();

it('distinguishes ordinary startup, empty shares and text for the importer', () => {
  expect(readShareTarget('?route=CPH-LHR')).toBeNull();
  expect(readShareTarget('?share-title=&share-text=+')).toEqual({ kind: 'empty' });
  expect(readShareTarget(search({ 'share-title': 'Flights', 'share-text': 'CPH LHR' }))).toEqual({
    kind: 'text',
    text: 'CPH LHR\nFlights',
  });
});
it('prefers links in url, then text, then title', () => {
  const fields = {
    'share-url': 'https://globehops.marki.im/?route=CPH-LHR&lang=sv',
    'share-text': 'Look https://globehops.marki.im/?route=JFK-LAX',
    'share-title': '?route=BUD-NRT',
  };
  expect(readShareTarget(search(fields))).toEqual({ kind: 'link', query: '?route=CPH-LHR' });
  expect(readShareTarget(search({ ...fields, 'share-url': 'https://example.com/' }))).toEqual({
    kind: 'link',
    query: '?route=JFK-LAX',
  });
  expect(readShareTarget(search({ ...fields, 'share-url': '', 'share-text': '' }))).toEqual({
    kind: 'link',
    query: '?route=BUD-NRT',
  });
  expect(
    readShareTarget(search({ 'share-text': 'http://localhost:5173/hu/?route=CPH-LHR' }), {
      origin: 'http://localhost:5173',
    }),
  ).toEqual({ kind: 'link', query: '?route=CPH-LHR' });
});
it('hands a non-link share to App only once', () => {
  expect(takePendingShare()).toBeNull();
  setPendingShare({ kind: 'text', text: 'CPH LHR' });
  expect(takePendingShare()).toEqual({ kind: 'text', text: 'CPH LHR' });
  expect(takePendingShare()).toBeNull();
  setPendingShare({ kind: 'empty' });
  expect(takePendingShare()).toEqual({ kind: 'empty' });
});
