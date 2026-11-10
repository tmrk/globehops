import type { RouteState } from '../types.ts';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import airportsUrl from '../data/generated/airports.json?url';
import timezonesUrl from '../data/generated/timezones.json?url';
import { airportCode, loadAirports, type AirportDataset } from '../data/airports.ts';
import { loadTimeZones, type TimeZoneTable } from '../data/timezones.ts';
import { buildSearchIndex, type SearchIndex } from '../data/search.ts';
import { homeAirport, welcomeSuggestions, FALLBACK_HOME } from '../data/suggestions.ts';
import { browserTimeZone } from '../lib/timezone.ts';
import { localizedCity } from '../data/placeNames.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { localeFromPath } from '../i18n/detect.ts';
import { replaceUrl } from '../analytics.ts';
import { visitLocaleAddress } from '../state/visitLocale.ts';
import { linkHasStops, parseLink, type LinkSection, type LinkState, type LinkStop } from '../state/link.ts';
import { resolveRouteCodes } from '../state/url.ts';
import { isNamedClock } from '../agent/contract.ts';
import { loadLastRoute, loadLastJourney } from '../state/storage.ts';
import type { PlanAction } from '../state/plan.ts';
import type { useViewPreferences } from './useViewPreferences.ts';
import type { useToast } from './useToast.ts';

type Setter<T> = Dispatch<SetStateAction<T>>;
interface AppLinksOptions {
  route: RouteState;
  planDispatch: Dispatch<PlanAction>;
  setEditing: Setter<number | null>;
  resetPreferences: ReturnType<typeof useViewPreferences>['resetToLink'];
  applyView: (link: LinkState) => void;
  showToast: ReturnType<typeof useToast>['showToast'];
}

function unknownAirports(missing: string[], t: ReturnType<typeof useI18n>['t']) {
  return missing.length === 1
    ? t('toasts.unknownAirport', missing[0])
    : t('toasts.unknownAirports', missing.join(', '));
}

/** Long-haul previews from the visitor's likely home airport, offered while there is no route. */
function suggestionsFor(index: SearchIndex, zones: TimeZoneTable | null) {
  const home = homeAirport(browserTimeZone(), { index, zones }) ?? index.iata.get(FALLBACK_HOME);
  return home ? welcomeSuggestions(home, index) : [];
}

/**
 * Whether startup will load a route, known before any data arrives: from the URL, else the remembered
 * journey or legacy route. Without one, the app opens on the globe and its clock.
 */
export function opensWithRoute(search = window.location.search): boolean {
  const fromUrl = parseLink(search);
  if (fromUrl.stops !== null) return linkHasStops(fromUrl);
  const saved = loadLastJourney();
  if (saved !== null) return linkHasStops(parseLink(saved));
  return (loadLastRoute()?.length ?? 0) > 0;
}

export function useAppLinks({
  route,
  planDispatch,
  setEditing,
  resetPreferences,
  applyView,
  showToast,
}: AppLinksOptions) {
  const { t, locale, cityNames, setVisitLocale } = useI18n();
  const [initialized, setInitialized] = useState(false);
  const [zones, setZones] = useState<TimeZoneTable | null>(null);
  const [zonesLoaded, setZonesLoaded] = useState(false);
  const [dataset, setDataset] = useState<AirportDataset | null>(null);
  const [baseIndex, setBaseIndex] = useState<SearchIndex | null>(null);
  // Only dataset, locale or exonym changes rebuild search; route edits and playback reuse it.
  const index = useMemo(() => {
    if (!baseIndex || !cityNames || locale === 'en') return baseIndex;
    return buildSearchIndex(
      baseIndex.entries.map((entry) => entry.airport),
      {
        extraNames: (airport) => [localizedCity(airport, locale, cityNames)],
      },
    );
  }, [baseIndex, cityNames, locale]);
  const suggestions = useMemo(() => (index ? suggestionsFor(index, zones) : []), [index, zones]);
  const [dataError, setDataError] = useState(false);
  const routeStopCount = useRef(0);
  useLayoutEffect(() => {
    routeStopCount.current = route.stops.filter((stop) => stop.airportId !== null).length;
  }, [route.stops]);
  /** Loads route tokens (codes with optional layovers) into the route, reporting unknown codes. */
  const loadCodes = useCallback(
    (codes: string[], idx: SearchIndex) => {
      const { stops, missing } = resolveRouteCodes(codes, idx);
      routeStopCount.current = stops.length;
      planDispatch({
        type: 'load',
        journeys: [{ airportIds: stops.map((s) => s.airport.id), layovers: stops.map((s) => s.layoverMin) }],
      });
      if (missing.length) {
        showToast(unknownAirports(missing, t));
      }
    },
    [showToast, t, planDispatch],
  );

  const applyLink = useCallback(
    (link: LinkState, idx: SearchIndex, search: string) => {
      let flightCounts = [Math.max(0, routeStopCount.current - 1)];
      const notices = locale === 'en' ? [...link.issues] : link.issues.length ? [t('errors.invalidLink')] : [];
      const comparedTrips = !!link.compare?.length && [link, ...link.compare].some((entry) => entry.sections?.length);
      const trip = comparedTrips || !!link.sections?.length;
      // Compared trips are a rectangle: every alternative gets as many journeys as the longest, empty if absent.
      const perOption = comparedTrips
        ? Math.max(...[link, ...(link.compare ?? [])].map((entry) => 1 + (entry.sections?.length ?? 0)))
        : 0;
      const alternative = (label: string | null, stops: LinkStop[], sections: LinkSection[] = []) => [
        { label, stops, stayMin: null as number | null },
        ...Array.from(
          { length: Math.max(0, perOption - 1) },
          (_, k) => sections[k] ?? { label: null, stops: [], stayMin: null },
        ),
      ];
      if (link.stops !== null) {
        const missing: string[] = [];
        const entries = comparedTrips
          ? [
              ...alternative(link.label ?? null, link.stops, link.sections),
              ...(link.compare ?? []).flatMap((entry) => alternative(entry.label, entry.stops, entry.sections)),
            ]
          : [
              { label: link.label ?? null, stops: link.stops, stayMin: null as number | null },
              ...(trip ? (link.sections ?? []) : (link.compare ?? []).map((entry) => ({ ...entry, stayMin: null }))),
            ];
        const journeys = entries.map((entry) => {
          const resolved = entry.stops.flatMap((stop, stopIndex) => {
            const result = resolveRouteCodes([stop.code], idx);
            if (!result.stops.length) {
              missing.push(stop.code);
              return [];
            }
            return [
              {
                ...stop,
                ...(stop.track && !resolveRouteCodes([entry.stops[stopIndex + 1]?.code ?? ''], idx).stops.length
                  ? { track: null }
                  : {}),
                airport: result.stops[0].airport,
              },
            ];
          });
          return {
            label: entry.label,
            stayMin: entry.stayMin,
            airportIds: resolved.map((s) => s.airport.id),
            layovers: resolved.map((s) => s.layoverMin),
            arrivals: resolved.map((s) => s.arrival),
            departures: resolved.map((s) => s.departure),
            tracks: resolved.map((s) => s.track ?? null),
          };
        });
        routeStopCount.current = journeys[0].airportIds.length;
        // Flight numbers count the first journey's flights, or a trip's (trip A's) flights across its journeys.
        flightCounts = (comparedTrips ? journeys.slice(0, perOption) : trip ? journeys : journeys.slice(0, 1)).map(
          (j) => Math.max(0, j.airportIds.length - 1),
        );
        planDispatch({ type: 'load', journeys, trip, ...(comparedTrips ? { sections: perOption } : {}) });
        setEditing(null);
        if (missing.length) notices.unshift(unknownAirports(missing, t));
      }
      if (link.view.leg !== undefined) {
        let flight = link.view.leg - 1;
        const section = flightCounts.findIndex((count) => {
          if (flight < count) return true;
          flight -= count;
          return false;
        });
        if (section >= 0) {
          if (section > 0) planDispatch({ type: 'activate', index: section });
          planDispatch({ type: 'route', index: section, action: { type: 'selectLeg', leg: flight } });
        } else
          notices.push(
            locale === 'en'
              ? `Flight ${link.view.leg} is outside this route; use 1 to ${flightCounts.reduce((a, b) => a + b, 0)}.`
              : t('errors.invalidLink'),
          );
      }
      if (notices.length) showToast(notices.join(' '));
      const targetLocale = localeFromPath(window.location.pathname, import.meta.env.BASE_URL) ?? link.view.lang;
      if (targetLocale) {
        void setVisitLocale(targetLocale);
        replaceUrl(visitLocaleAddress(window.location.href, import.meta.env.BASE_URL, targetLocale));
      }
      const linkedClock = !isNamedClock(link.view.clock)
        ? resolveRouteCodes([link.view.clock], idx).stops[0]?.airport
        : undefined;
      resetPreferences({ ...link.view, clock: linkedClock ? airportCode(linkedClock) : link.view.clock }, search);
      applyView(link);
    },
    [showToast, t, locale, setVisitLocale, resetPreferences, planDispatch, setEditing, applyView],
  );

  const zoneLoadError = useEffectEvent(() => showToast(t('toasts.zonesUnavailable')));
  // URL route, else the remembered journey (or legacy route); otherwise the route stays empty.
  const initializeRoute = useEffectEvent((idx: SearchIndex) => {
    const fromUrl = parseLink(window.location.search);
    if (fromUrl.stops !== null) applyLink(fromUrl, idx, window.location.search);
    else {
      const saved = loadLastJourney();
      if (saved !== null) {
        const remembered = parseLink(saved);
        if (remembered.stops === null) remembered.stops = [];
        applyLink(remembered, idx, saved);
      } else {
        const legacy = loadLastRoute();
        if (legacy !== null) loadCodes(legacy, idx);
      }
      // A view-only link still overrides the remembered/default view.
      if (window.location.search) applyLink(fromUrl, idx, window.location.search);
    }
    setInitialized(true);
  });

  useEffect(() => {
    const ctrl = new AbortController();
    loadTimeZones(timezonesUrl, ctrl.signal)
      .then(setZones)
      .catch(() => {
        if (!ctrl.signal.aborted) zoneLoadError();
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setZonesLoaded(true);
      });
    loadAirports(airportsUrl, ctrl.signal)
      .then((data) => {
        const idx = buildSearchIndex(data.airports);
        setDataset(data);
        setBaseIndex(idx);
        initializeRoute(idx);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setDataError(true);
      });
    return () => ctrl.abort();
  }, []);

  const lookup = useCallback((id: number) => dataset?.byId.get(id), [dataset]);
  return { dataset, zones, zonesLoaded, index, suggestions, dataError, initialized, lookup, loadCodes, applyLink };
}
