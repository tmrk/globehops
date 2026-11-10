import type { TrackFormat } from '../track.ts';
import type { ImportedFlight, ImportContext, ImportOptions, ImportResult, ParsedDocument } from './types.ts';
import { MAX_IMPORT_FLIGHTS } from './types.ts';
import { ImportFailure, MAX_TEXT_BYTES, ParseState } from './common.ts';
import { parseGeoJson } from './geojson.ts';
import { parseXml } from './xml.ts';
import { parseGpx } from './gpx.ts';
import { parseKml } from './kml.ts';
import { extractKml } from './kmz.ts';
import { hasCsvHeader, parseCsv } from './csv.ts';
import { parseIgc } from './igc.ts';
import { parseFpl, parsePln } from './plans.ts';
import { parseRoute, plausibleRoute } from './route.ts';
import { codeOf, matchAirport, namedEnds } from './airports.ts';
import { splitRecorded, validateTimes } from './recorded.ts';
export type {
  ImportContext,
  ImportOptions,
  ImportedFlight,
  ImportErrorCode,
  ImportWarningCode,
  ImportIssue,
  ImportResult,
} from './types.ts';
export { MAX_IMPORT_FLIGHTS } from './types.ts';
export { groupFlights } from './group.ts';

const extensions: Record<string, TrackFormat> = {
  geojson: 'geojson',
  json: 'geojson',
  gpx: 'gpx',
  kml: 'kml',
  kmz: 'kmz',
  csv: 'csv',
  tsv: 'csv',
  igc: 'igc',
  fpl: 'fpl',
  pln: 'pln',
  lnmpln: 'pln',
};
function sniff(text: string): TrackFormat | null {
  const s = text.replace(/^\uFEFF/, '').trimStart();
  if (s.startsWith('<')) {
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        i++;
        continue;
      }
      const marker = s.startsWith('<?', i) ? '?>' : s.startsWith('<!--', i) ? '-->' : null;
      if (marker) {
        const end = s.indexOf(marker, i + 2);
        if (end < 0) return null;
        i = end + marker.length;
        continue;
      }
      const root = /^<([\w:.-]+)/.exec(s.slice(i))?.[1].toLowerCase().split(':').at(-1);
      if (root === 'gpx') return 'gpx';
      if (root === 'kml') return 'kml';
      if (root === 'flight-plan') return 'fpl';
      if (['simbase.document', 'flightplan.flightplan', 'littlenavmap'].includes(root ?? '')) return 'pln';
      return null;
    }
  }
  if (
    s.startsWith('{') &&
    /"type"\s*:\s*"(?:FeatureCollection|Feature|LineString|MultiLineString|GeometryCollection|Point|MultiPoint|Polygon|MultiPolygon)"/.test(
      s,
    )
  )
    return 'geojson';
  if (/^A[^\r\n]*[\r\n]/.test(s) && /^B\d{6}/m.test(s)) return 'igc';
  if (/^H[FP]DTE/m.test(s) && /^B\d{6}/m.test(s)) return 'igc';
  if (hasCsvHeader(s) || /^[+-]?\d+(?:\.\d+)?\s*[,;\t]\s*[+-]?\d+(?:\.\d+)?\s*(?:[,;\t]|\r?$)/m.test(s)) return 'csv';
  return plausibleRoute(s) ? 'route' : null;
}
/** Specific extensions select a parser; generic names defer to recognised content. */
export function detectFormat(text: string, fileName?: string | null): TrackFormat | null {
  const extension = fileName?.split('.').at(-1)?.toLowerCase() ?? '';
  if (!['txt', 'json', 'xml', ''].includes(extension) && extensions[extension]) return extensions[extension];
  return sniff(text);
}
/** Bounded sniff only: paste detection must never parse an entire large document. */
export function looksLikeRoute(text: string): boolean {
  const prefix = text.slice(0, 16_384);
  return sniff(prefix) !== null;
}
function checkText(text: string): void {
  // Check UTF-16 length first to avoid allocating a huge encoded copy for hostile strings.
  if (text.length > MAX_TEXT_BYTES || new TextEncoder().encode(text).length > MAX_TEXT_BYTES)
    throw new ImportFailure('too_large', 'Route text exceeds 20 MB.');
}
/** UTF-8 inputs stay local. KMZ extraction is bounded before and during decompression. */
export async function importRoute(
  input: string | Uint8Array,
  context: ImportContext,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const state = new ParseState();
  let format: TrackFormat | null = options.format ?? null;
  const fileName = options.fileName ?? null;
  let name: string | null = fileName ? fileName.replace(/\.[^.]+$/, '') : null;
  const flights: ImportedFlight[] = [];
  try {
    if (input.length > MAX_TEXT_BYTES) throw new ImportFailure('too_large', 'Route input exceeds 20 MB.');
    const zip = input instanceof Uint8Array && input[0] === 0x50 && input[1] === 0x4b;
    let text: string;
    if (format === 'kmz' || (!format && (zip || /\.kmz$/i.test(fileName ?? '')))) {
      format ??= 'kmz';
      if (typeof input === 'string')
        throw new ImportFailure('invalid', 'KMZ requires binary ZIP data.', { reason: 'Expected ZIP bytes' });
      text = await extractKml(input);
    } else text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    checkText(text);
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) throw new ImportFailure('empty', 'No route text was provided.');
    format ??= detectFormat(text, fileName);
    if (!format) throw new ImportFailure('unrecognised', 'This text does not look like a supported route format.');
    let parsed: ParsedDocument;
    switch (format) {
      case 'geojson':
        parsed = parseGeoJson(text, state);
        break;
      case 'csv':
        parsed = parseCsv(text, state);
        break;
      case 'igc':
        parsed = parseIgc(text, state);
        break;
      case 'route':
        parsed = parseRoute(text, context, state);
        break;
      case 'gpx':
      case 'kml':
      case 'kmz':
      case 'fpl':
      case 'pln': {
        const root = parseXml(text);
        const expected: Partial<Record<TrackFormat, string[]>> = {
          gpx: ['gpx'],
          kml: ['kml'],
          kmz: ['kml'],
          fpl: ['flight-plan'],
          pln: ['simbase.document', 'flightplan.flightplan', 'littlenavmap'],
        };
        if (!expected[format]?.includes(root.tag))
          throw new ImportFailure('invalid', 'The XML root does not match this format.', {
            reason: `Unexpected <${root.tag}>`,
          });
        parsed =
          format === 'gpx'
            ? parseGpx(root, state)
            : format === 'fpl'
              ? parseFpl(root, state)
              : format === 'pln'
                ? parsePln(root, state)
                : parseKml(root, state);
        break;
      }
      default:
        throw new ImportFailure('unsupported', `Importing ${format} is not supported by the route-file parser.`, {
          format,
        });
    }
    name = parsed.name ?? name;
    let total = 0;
    for (const path of parsed.paths) {
      if (path.points.length < 2) continue;
      validateTimes(path, state);
      const pieces = path.kind === 'recorded' ? splitRecorded(path.points) : [path.points];
      if (pieces.length > 1)
        state.warn('split_flights', `The recorded log was split into ${pieces.length} flights at ground stops.`, {
          count: pieces.length,
        });
      const hints = namedEnds([path.name, path.description].filter(Boolean).join(' '), context);
      for (const points of pieces) {
        total++;
        if (flights.length >= MAX_IMPORT_FLIGHTS) continue;
        const first = points[0],
          last = points[points.length - 1];
        const from = matchAirport(
          first,
          context,
          (first.name ? context.byCode(first.name) : undefined) ??
            (points[0] === path.points[0] ? hints?.[0] : undefined),
        );
        const to = matchAirport(
          last,
          context,
          (last.name ? context.byCode(last.name) : undefined) ?? (last === path.points.at(-1) ? hints?.[1] : undefined),
        );
        if (!from || !to) throw new ImportFailure('no_path', 'No airports are available to match the path endpoints.');
        const flight = flights.length + 1;
        for (const [end, match] of [
          ['start', from],
          ['end', to],
        ] as const)
          if (match.km > 30)
            state.warn(
              'far_endpoint',
              `Flight ${flight} ${end} is ${Math.round(match.km)} km from ${codeOf(match.airport)}.`,
              { end, flight, code: codeOf(match.airport), km: Math.round(match.km) },
            );
        if (from.airport.id === to.airport.id)
          state.warn('same_airport', `Flight ${flight} starts and ends at ${codeOf(from.airport)}.`, {
            flight,
            code: codeOf(from.airport),
          });
        flights.push({
          track: { kind: path.kind ?? 'planned', points, source: { format, name: path.name ?? fileName } },
          from: from.airport,
          to: to.airport,
          fromDistanceKm: from.km,
          toDistanceKm: to.km,
        });
      }
    }
    if (total > MAX_IMPORT_FLIGHTS)
      state.warn('truncated_flights', `Kept ${MAX_IMPORT_FLIGHTS} of ${total} flights.`, {
        kept: MAX_IMPORT_FLIGHTS,
        total,
      });
    if (!flights.length) throw new ImportFailure('no_path', 'No path contains at least two valid points.');
    if (state.droppedPoints)
      state.warn('dropped_points', `${state.droppedPoints} invalid points were dropped.`, {
        count: state.droppedPoints,
      });
    return {
      ok: true,
      format,
      name,
      flights,
      warnings: state.warnings,
      error: null,
      stats: { points: state.points - state.droppedPoints, droppedPoints: state.droppedPoints },
    };
  } catch (error) {
    const failure =
      error instanceof ImportFailure
        ? error
        : new ImportFailure('invalid', 'The route could not be read.', {
            reason: error instanceof Error ? error.message.slice(0, 160) : 'Invalid input',
          });
    if (state.droppedPoints)
      state.warn('dropped_points', `${state.droppedPoints} invalid points were dropped.`, {
        count: state.droppedPoints,
      });
    return {
      ok: false,
      format,
      name,
      flights: [],
      warnings: state.warnings,
      error: { code: failure.code, message: failure.message, params: failure.params },
      stats: { points: state.points - state.droppedPoints, droppedPoints: state.droppedPoints },
    };
  }
}
