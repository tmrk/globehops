import { MAX_JOURNEYS, MAX_URL_LENGTH } from './contract.ts';
import { linkStateToDocument, validateItineraryDocument, type DocIssue, type DocumentResult } from './itinerary.ts';
import { parseLink } from '../state/link.ts';

const object = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
/** Normalize the tool shorthand into the same document used by links and validation. */
export function comparisonDocument(raw: unknown): DocumentResult {
  if (!object(raw)) return validateItineraryDocument(raw);
  if (raw.version !== undefined) {
    const checked = validateItineraryDocument(raw);
    if (checked.ok && !checked.doc.journeys)
      return { ok: false, issues: [{ path: '/journeys', code: 'required', message: 'Supply journeys to compare.' }] };
    return checked;
  }
  const issues: DocIssue[] = [];
  const pointerKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  for (const key of Object.keys(raw))
    if (!['journeys', 'view'].includes(key))
      issues.push({ path: `/${pointerKey(key)}`, code: 'additionalProperties', message: `Unknown property ${key}.` });
  const journeys = Array.isArray(raw.journeys)
    ? raw.journeys.slice(0, MAX_JOURNEYS).map((journey: unknown, index: number) => {
        const path = `/journeys/${index}`;
        if (!object(journey)) return journey;
        for (const key of Object.keys(journey))
          if (!['label', 'route', 'stops'].includes(key))
            issues.push({
              path: `${path}/${pointerKey(key)}`,
              code: 'additionalProperties',
              message: `Unknown property ${key}.`,
            });
        if ((journey.route !== undefined) === (journey.stops !== undefined))
          issues.push({ path, code: 'oneOf', message: 'Supply exactly one of route or stops.' });
        if (journey.route === undefined) return journey;
        if (typeof journey.route !== 'string' || journey.route.length > MAX_URL_LENGTH) {
          issues.push({
            path: `${path}/route`,
            code: 'type',
            message: `route must be a string of at most ${MAX_URL_LENGTH} characters.`,
          });
          return { stops: [] };
        }
        const link = parseLink(`?route=${encodeURIComponent(journey.route)}`);
        issues.push(...link.issues.map((message) => ({ path: `${path}/route`, code: 'invalid_link', message })));
        const doc = linkStateToDocument(link);
        return { ...(journey.label !== undefined ? { label: journey.label } : {}), stops: doc.stops };
      })
    : raw.journeys;
  if (Array.isArray(raw.journeys) && raw.journeys.length > MAX_JOURNEYS)
    issues.push({ path: '/journeys', code: 'items', message: `Use 1 to ${MAX_JOURNEYS} journeys.` });
  const checked = validateItineraryDocument({
    version: 1,
    journeys,
    ...(raw.view !== undefined ? { view: raw.view } : {}),
  });
  if (!checked.ok) issues.push(...checked.issues);
  return issues.length ? { ok: false, issues } : checked;
}
