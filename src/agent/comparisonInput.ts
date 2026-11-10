import { MAX_JOURNEYS, MAX_SECTIONS, MAX_URL_LENGTH } from './contract.ts';
import { linkStateToDocument, validateItineraryDocument, type DocIssue, type DocumentResult } from './itinerary.ts';
import { parseLink, parseStay } from '../state/link.ts';

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
  const keys = (value: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        issues.push({
          path: `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          code: 'additionalProperties',
          message: `Unknown property ${key}.`,
        });
  };
  const routeStops = (route: unknown, path: string) => {
    if (typeof route !== 'string' || route.length > MAX_URL_LENGTH) {
      issues.push({ path, code: 'type', message: `route must be a string of at most ${MAX_URL_LENGTH} characters.` });
      return [];
    }
    const link = parseLink(`?route=${encodeURIComponent(route)}`);
    issues.push(...link.issues.map((message) => ({ path, code: 'invalid_link', message })));
    return linkStateToDocument(link).stops;
  };
  const section = (value: unknown, path: string) => {
    if (!object(value)) return value;
    keys(value, ['label', 'route', 'stops', 'stay'], path);
    if ((value.route !== undefined) === (value.stops !== undefined))
      issues.push({ path, code: 'oneOf', message: 'Supply exactly one of route or stops.' });
    const stayMinutes = typeof value.stay === 'string' ? parseStay(value.stay) : value.stay;
    if (value.stay !== undefined && stayMinutes === null)
      issues.push({
        path: `${path}/stay`,
        code: 'range',
        message: 'Use stay minutes or a duration such as 5d, 36h or 90m.',
      });
    return {
      ...(value.label !== undefined ? { label: value.label } : {}),
      ...(value.stay !== undefined ? { stayMinutes } : {}),
      stops: value.route !== undefined ? routeStops(value.route, `${path}/route`) : value.stops,
    };
  };
  keys(raw, ['journeys', 'view'], '');
  const journeys = Array.isArray(raw.journeys)
    ? raw.journeys.slice(0, MAX_JOURNEYS).map((journey: unknown, index: number) => {
        const path = `/journeys/${index}`;
        if (!object(journey)) return journey;
        keys(journey, ['label', 'route', 'stops', 'sections', 'returnRoute', 'stay'], path);
        if ([journey.route, journey.stops, journey.sections].filter((value) => value !== undefined).length !== 1)
          issues.push({ path, code: 'oneOf', message: 'Supply exactly one of route, stops or sections.' });
        if (journey.returnRoute !== undefined && journey.route === undefined)
          issues.push({ path: `${path}/returnRoute`, code: 'required', message: 'returnRoute requires route.' });
        if (journey.stay !== undefined && journey.returnRoute === undefined)
          issues.push({
            path: `${path}/stay`,
            code: 'required',
            message: 'stay requires returnRoute (or put stay on a later section).',
          });
        const label = journey.label !== undefined ? { label: journey.label } : {};
        if (journey.returnRoute !== undefined)
          return {
            ...label,
            sections: [
              section({ route: journey.route }, `${path}/sections/0`),
              section(
                { route: journey.returnRoute, ...(journey.stay !== undefined ? { stay: journey.stay } : {}) },
                `${path}/sections/1`,
              ),
            ],
          };
        if (journey.sections !== undefined) {
          if (Array.isArray(journey.sections) && journey.sections.length > MAX_SECTIONS)
            issues.push({
              path: `${path}/sections`,
              code: 'items',
              message: `Use 1 to ${MAX_SECTIONS} trip sections.`,
            });
          return {
            ...label,
            sections: Array.isArray(journey.sections)
              ? journey.sections.slice(0, MAX_SECTIONS).map((value, i) => section(value, `${path}/sections/${i}`))
              : journey.sections,
          };
        }
        return {
          ...label,
          stops: journey.route !== undefined ? routeStops(journey.route, `${path}/route`) : journey.stops,
        };
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
