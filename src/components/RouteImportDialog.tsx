import { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { Translate } from '../i18n/catalogue.ts';
import { airportCode } from '../data/airports.ts';
import { loadNavaids } from '../data/navaidsLoader.ts';
import type { ImportContext, ImportIssue, ImportResult, ImportWarningCode } from '../lib/import/index.ts';
import { groupFlights } from '../lib/import/group.ts';
import { legTrack, type TrackFormat } from '../lib/track.ts';
import { trackEvent } from '../analytics.ts';
import type { DistanceUnit } from '../types.ts';
import { IconAlert, IconClose, IconImport, IconTrack } from './Icons.tsx';

export interface RouteImportDialogHandle {
  /** Opens the dialog; with a dropped/opened file or pasted text, reads it straight away. */
  open: (source?: { file?: File; text?: string }) => void;
}

interface Props {
  /** Airports for matching path ends; null while they load. */
  context: ImportContext | null;
  unit: DistanceUnit;
  /** Whether a journey is on the globe to compare an import with. */
  canCompare: boolean;
  onImport: (result: ImportResult, mode: 'replace' | 'compare') => void;
}

/** Files GlobeHops reads, for the file picker. */
export const IMPORT_ACCEPT = '.gpx,.kml,.kmz,.geojson,.json,.csv,.tsv,.txt,.igc,.fpl,.pln,.lnmpln';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FORMAT_NAMES: Record<TrackFormat, string> = {
  geojson: 'GeoJSON',
  gpx: 'GPX',
  kml: 'KML',
  kmz: 'KMZ',
  csv: 'CSV',
  igc: 'IGC',
  fpl: 'FPL',
  pln: 'PLN',
  route: '',
  link: '',
  document: '',
};

type State =
  | { phase: 'input'; error?: string }
  | { phase: 'reading' }
  | { phase: 'result'; result: ImportResult; source: string | null };

/**
 * “Import a flight path”: a file (dropped, opened or chosen) or pasted text — GPX, KML/KMZ, GeoJSON, CSV, IGC,
 * Garmin FPL, MSFS/Little Navmap plans or an aviation route string — read on this device, previewed with what
 * it contains, then shown on the globe or compared with the journey there.
 */
export const RouteImportDialog = forwardRef<RouteImportDialogHandle, Props>(function RouteImportDialog(
  { context, unit, canCompare, onImport },
  ref,
) {
  const { t, fmt } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: 'input' });
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const pasteId = useId();

  const read = useCallback(
    async (input: string | Uint8Array, fileName: string | null) => {
      if (!context) return;
      setState({ phase: 'reading' });
      const { importRoute, detectFormat } = await import('../lib/import/index.ts');
      const sample = typeof input === 'string' ? input : '';
      const format = typeof input === 'string' ? detectFormat(sample, fileName) : null;
      const withNavaids = format === 'route' ? { ...context, navaids: await loadNavaids() } : context;
      const result = await importRoute(input, withNavaids, { fileName });
      trackEvent('route_import', { format: result.format ?? 'unknown', flights: result.flights.length });
      setState(
        result.ok ? { phase: 'result', result, source: fileName } : { phase: 'input', error: importError(result, t) },
      );
    },
    [context, t],
  );

  const readFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setState({ phase: 'input', error: t('import.error.too_large') });
        return;
      }
      const binary = /\.kmz$/i.test(file.name);
      const input = binary ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      await read(input, file.name);
    },
    [read, t],
  );

  useImperativeHandle(ref, () => ({
    open: (source) => {
      setDragging(false);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      if (source?.file) void readFile(source.file);
      else if (source?.text) {
        setText(source.text);
        void read(source.text, null);
      } else setState({ phase: 'input' });
    },
  }));

  const close = () => dialogRef.current?.close();
  const result = state.phase === 'result' ? state.result : null;
  const flights = result?.flights ?? [];
  // Only a single journey joins a comparison; a trip replaces the plan.
  const journeys = result ? groupFlights(result.flights).journeys.length : 0;

  return (
    <dialog
      ref={dialogRef}
      className="about route-import"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
    >
      <div className="about__inner">
        <button type="button" className="icon-btn about__close" aria-label={t('common.close')} onClick={close}>
          <IconClose />
        </button>
        <div className="route-import__head">
          <span className="route-import__mark" aria-hidden="true">
            <IconTrack size={22} />
          </span>
          <h2 id={titleId}>{t('import.title')}</h2>
        </div>

        {state.phase !== 'result' && (
          <>
            <p className="route-import__lede">{t('import.lede')}</p>
            <div className={`route-import__drop${dragging ? ' is-dragging' : ''}`}>
              <IconImport size={22} className="route-import__drop-icon" />
              <button
                type="button"
                className="route-import__choose"
                disabled={!context || state.phase === 'reading'}
                onClick={() => fileRef.current?.click()}
              >
                {t('import.choose')}
              </button>
              <span className="route-import__drop-hint">{t('import.dropHint')}</span>
              <input
                ref={fileRef}
                type="file"
                accept={IMPORT_ACCEPT}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void readFile(file);
                }}
              />
            </div>
            <p className="route-import__formats">{t('import.formats')}</p>
            <label className="route-import__label" htmlFor={pasteId}>
              {t('import.pasteLabel')}
            </label>
            <textarea
              id={pasteId}
              className="route-import__paste"
              rows={3}
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder={t('import.pastePlaceholder')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {state.phase === 'input' && state.error && (
              <p className="route-import__error" role="alert">
                <IconAlert size={15} />
                <span>{state.error}</span>
              </p>
            )}
            <div className="route-import__actions">
              <button
                type="button"
                className="route-import__primary"
                disabled={!context || !text.trim() || state.phase === 'reading'}
                onClick={() => void read(text, null)}
              >
                {state.phase === 'reading' ? t('import.reading') : t('import.read')}
              </button>
            </div>
            <p className="route-import__privacy">{t('import.privacy')}</p>
          </>
        )}

        {result && (
          <>
            <p className="route-import__name">
              <span>{result.name ?? (state.phase === 'result' ? state.source : null) ?? t('import.pasted')}</span>
              {result.format && FORMAT_NAMES[result.format] && (
                <span className="route-import__format">{FORMAT_NAMES[result.format]}</span>
              )}
            </p>
            <ol className="route-import__flights" aria-label={t('import.flights')}>
              {flights.map((flight, i) => {
                const lt = legTrack(flight.track);
                const minutes = lt.times ? (lt.times[lt.times.length - 1] - lt.times[0]) / 60000 : null;
                return (
                  <li key={i} className="route-import__flight">
                    <span className={`route-import__kind route-import__kind--${lt.kind}`}>
                      {lt.kind === 'recorded' ? t('track.recordedShort') : t('track.plannedShort')}
                    </span>
                    <span className="route-import__route">
                      {airportCode(flight.from)} → {airportCode(flight.to)}
                    </span>
                    <span className="route-import__facts">
                      {[
                        fmt.distance(lt.distanceKm, unit),
                        minutes !== null && minutes > 0 ? fmt.duration(minutes) : null,
                        t('import.points', fmt.number(lt.points)),
                        lt.altitudesKm ? t('import.withAltitudes') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                );
              })}
            </ol>
            {result.warnings.length > 0 && (
              <ul className="route-import__warnings">
                {result.warnings.map((warning, i) => (
                  <li key={i}>{importWarning(warning, t)}</li>
                ))}
              </ul>
            )}
            <div className="route-import__actions">
              <button type="button" className="text-btn" onClick={() => setState({ phase: 'input' })}>
                {t('import.another')}
              </button>
              {canCompare && journeys === 1 && (
                <button
                  type="button"
                  className="route-import__secondary"
                  onClick={() => {
                    onImport(result, 'compare');
                    close();
                  }}
                >
                  {t('import.compare')}
                </button>
              )}
              <button
                type="button"
                className="route-import__primary"
                onClick={() => {
                  onImport(result, 'replace');
                  close();
                }}
              >
                {t('import.show')}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
});

/** The planner's way in, beside “Map your booking with AI”. */
export function RouteImportEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="ai-entry route-entry" onClick={onOpen}>
      <span className="ai-entry__icon" aria-hidden="true">
        <IconTrack size={18} />
      </span>
      <span className="ai-entry__text">
        <span className="ai-entry__title">{t('import.entry')}</span>
        <span className="ai-entry__detail">{t('import.entryDetail')}</span>
      </span>
    </button>
  );
}

function importError(result: ImportResult, t: Translate): string {
  const error = result.error;
  if (!error) return t('import.error.no_path');
  if (error.code === 'invalid') return t('import.error.invalid', String(error.params.reason ?? error.message));
  return t(`import.error.${error.code}`);
}

/** Warnings in the reader's language, from each warning's code and parameters. */
function importWarning(warning: ImportIssue<ImportWarningCode>, t: Translate): string {
  const p = warning.params;
  const s = (key: string) => String(p[key] ?? '');
  switch (warning.code) {
    case 'dropped_points':
      return t('import.warning.dropped_points', s('count'));
    case 'far_endpoint':
      return t(
        p.end === 'end' ? 'import.warning.far_end' : 'import.warning.far_start',
        s('flight'),
        s('km'),
        s('code'),
      );
    case 'unresolved_waypoints':
      return t('import.warning.unresolved_waypoints', s('names'));
    case 'airway_direct':
      return t('import.warning.airway_direct', s('airways'));
    case 'procedure_direct':
      return t('import.warning.procedure_direct', s('names'));
    case 'ambiguous_waypoint':
      return t('import.warning.ambiguous_waypoint', s('name'));
    case 'times_unordered':
      return t('import.warning.times_unordered', s('count'));
    case 'times_partial':
      return t('import.warning.times_partial');
    case 'altitude_feet_assumed':
      return t('import.warning.altitude_feet_assumed');
    case 'altitude_dropped':
      return t('import.warning.altitude_dropped');
    case 'split_flights':
      return t('import.warning.split_flights', s('count'));
    case 'truncated_flights':
      return t('import.warning.truncated_flights', s('kept'), s('total'));
    case 'same_airport':
      return t('import.warning.same_airport', s('flight'), s('code'));
    case 'kml_line_preferred':
      return t('import.warning.kml_line_preferred');
  }
}
