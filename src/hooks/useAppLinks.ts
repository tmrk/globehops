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
import { parseLink, type LinkState } from '../state/link.ts';
import { resolveRouteCodes } from '../state/url.ts';
import { isNamedClock } from '../agent/contract.ts';
import { loadLastRoute, loadLastJourney } from '../state/storage.ts';
import type { CompareAction } from '../state/compare.ts';
import type { RouteAction } from '../state/route.ts';
import type { useViewPreferences } from './useViewPreferences.ts';
import type { useToast } from './useToast.ts';

type Setter<T> = Dispatch<SetStateAction<T>>;
interface AppLinksOptions {
  route: RouteState;
  dispatch: Dispatch<RouteAction>;
  compareDispatch: Dispatch<CompareAction>;
  setCopiedDraft: Setter<{ index: number; airportIds: (number | null)[] } | null>;
  setEditing: Setter<number | null>;
  setIsExample: Setter<boolean>;
  resetPreferences: ReturnType<typeof useViewPreferences>['resetToLink'];
  applyView: (link: LinkState) => void;
  showToast: ReturnType<typeof useToast>['showToast'];
}

function unknownAirports(missing: string[], t: ReturnType<typeof useI18n>['t']) {
  return missing.length === 1
    ? t('toasts.unknownAirport', missing[0])
    : t('toasts.unknownAirports', missing.join(', '));
}

/** Shared by the memoized welcome rows and asynchronous first-visit initialization. */
function suggestionsFor(index: SearchIndex, zones: TimeZoneTable | null) {
  const home = homeAirport(browserTimeZone(), { index, zones }) ?? index.iata.get(FALLBACK_HOME);
  return home ? welcomeSuggestions(home, index) : [];
}

export function useAppLinks({
  route,
  dispatch,
  compareDispatch,
  setCopiedDraft,
  setEditing,
  setIsExample,
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
    (codes: string[], idx: SearchIndex, opts: { example?: boolean } = {}) => {
      const { stops, missing } = resolveRouteCodes(codes, idx);
      routeStopCount.current = stops.length;
      compareDispatch({
        type: 'load',
        journeys: [{ airportIds: stops.map((s) => s.airport.id), layovers: stops.map((s) => s.layoverMin) }],
      });
      setIsExample(!!opts.example);
      if (missing.length) {
        showToast(unknownAirports(missing, t));
      }
    },
    [showToast, t, compareDispatch, setIsExample],
  );

  const applyLink = useCallback(
    (link: LinkState, idx: SearchIndex, search: string) => {
      let stopCount = routeStopCount.current;
      const notices = locale === 'en' ? [...link.issues] : link.issues.length ? [t('errors.invalidLink')] : [];
      if (link.stops !== null) {
        const missing: string[] = [];
        const journeys = [{ label: link.label, stops: link.stops }, ...(link.compare ?? [])].map((entry) => {
          const resolved = entry.stops.flatMap((stop) => {
            const result = resolveRouteCodes([stop.code], idx);
            if (!result.stops.length) {
              missing.push(stop.code);
              return [];
            }
            return [{ ...stop, airport: result.stops[0].airport }];
          });
          return {
            label: entry.label,
            airportIds: resolved.map((s) => s.airport.id),
            layovers: resolved.map((s) => s.layoverMin),
            arrivals: resolved.map((s) => s.arrival),
            departures: resolved.map((s) => s.departure),
          };
        });
        stopCount = routeStopCount.current = journeys[0].airportIds.length;
        compareDispatch({ type: 'load', journeys });
        setCopiedDraft(null);
        setEditing(null);
        setIsExample(false);
        if (missing.length) notices.unshift(unknownAirports(missing, t));
      }
      if (link.view.leg !== undefined) {
        if (link.view.leg < stopCount) dispatch({ type: 'selectLeg', leg: link.view.leg - 1 });
        else
          notices.push(
            locale === 'en'
              ? `Flight ${link.view.leg} is outside this route; use 1 to ${Math.max(0, stopCount - 1)}.`
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
    [
      showToast,
      t,
      locale,
      setVisitLocale,
      dispatch,
      resetPreferences,
      compareDispatch,
      setCopiedDraft,
      setEditing,
      setIsExample,
      applyView,
    ],
  );

  const zoneLoadError = useEffectEvent(() => showToast(t('toasts.zonesUnavailable')));
  const initializeRoute = useEffectEvent((idx: SearchIndex, loadedZones?: TimeZoneTable | null): boolean => {
    const fromUrl = parseLink(window.location.search);
    const hasRouteInput = [...new URLSearchParams(window.location.search).keys()].some((key) =>
      /^(route|itinerary)$/i.test(key),
    );
    if (fromUrl.stops !== null) applyLink(fromUrl, idx, window.location.search);
    else {
      const saved = loadLastJourney();
      if (saved !== null) {
        const remembered = parseLink(saved);
        if (remembered.stops === null) remembered.stops = [];
        applyLink(remembered, idx, saved);
      } else {
        const legacy = loadLastRoute();
        // Only a first-time example waits for the zone lookup, including a failed request.
        if (legacy === null && !hasRouteInput && loadedZones === undefined) return false;
        const first = legacy === null ? suggestionsFor(idx, loadedZones ?? zones)[0] : undefined;
        loadCodes(legacy ?? (first ? [airportCode(first.from), airportCode(first.to)] : []), idx, {
          example: legacy === null,
        });
      }
      // A view-only link still overrides the remembered/default view.
      if (window.location.search) applyLink(fromUrl, idx, window.location.search);
    }
    setInitialized(true);
    return true;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    const zonesReady = loadTimeZones(timezonesUrl, ctrl.signal)
      .then((table) => {
        setZones(table);
        return table;
      })
      .catch(() => {
        if (!ctrl.signal.aborted) zoneLoadError();
        return null;
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setZonesLoaded(true);
      });
    loadAirports(airportsUrl, ctrl.signal)
      .then(async (data) => {
        const idx = buildSearchIndex(data.airports);
        setDataset(data);
        setBaseIndex(idx);
        if (!initializeRoute(idx)) {
          const table = await zonesReady;
          if (!ctrl.signal.aborted) initializeRoute(idx, table);
        }
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
