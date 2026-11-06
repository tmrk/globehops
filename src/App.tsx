import { useWebTools } from './hooks/useWebTools.ts';
import { parseWebCommand } from './agent/webTools.ts';
import { createAgentContext, planItinerary, planComparison } from './agent/plan.ts';
import { linkStateToDocument, decodeItineraryParam } from './agent/itinerary.ts';
import { useI18n } from './i18n/I18nProvider.tsx';
import { localizedPath, localeFromPath } from './i18n/detect.ts';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { AboutDialog, type AboutDialogHandle } from './components/AboutDialog.tsx';
import { AirportPicker, type AirportPickerHandle } from './components/AirportPicker.tsx';
import { Brand, VersionTag } from './components/Brand.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlobeHud } from './components/GlobeHud.tsx';
import {
  IconCheck,
  IconChevronUp,
  IconInfo,
  IconPencil,
  IconShare,
  IconPlay,
  IconPlane,
  IconCompare,
  IconTrash,
} from './components/Icons.tsx';
import { MapTools } from './components/MapTools.tsx';
import { StopList } from './components/StopList.tsx';
import { Summary } from './components/Summary.tsx';
import { TimeBar } from './components/TimeBar.tsx';
import { Toast } from './components/Toast.tsx';
import { useGeolocation } from './hooks/useGeolocation.ts';
import { effectiveReducedMotion } from './lib/motion.ts';
import { useToast } from './hooks/useToast.ts';
import { useBottomSheet } from './hooks/useBottomSheet.ts';

import timezonesUrl from './data/generated/timezones.json?url';
import { loadTimeZones, zoneForAirport, type TimeZoneTable } from './data/timezones.ts';
import { computeComparison, compareMetrics, comparisonRange, JOURNEY_IDS } from './lib/compare.ts';
import { comparisonGlobeRoute, journeyLegOffsets, localLegAt } from './lib/compareView.ts';
import { compareReducer, createCompareState } from './state/compare.ts';
import { CompareSummary } from './components/CompareSummary.tsx';
import { JourneyTabs } from './components/JourneyTabs.tsx';
import { journeyStateAt } from './lib/timeline.ts';

import { SimulationClock } from './state/clock.ts';
import { createSimulationFeed, type SimulationContext } from './state/simulation.ts';
import { useClockPhase } from './hooks/useClock.ts';
import {
  parseLink,
  serializeLink,
  type LinkState,
  type LinkView,
  type LinkDefaultKey,
  type SerializableLinkStop,
} from './state/link.ts';
import airportsUrl from './data/generated/airports.json?url';
import { airportCode, loadAirports, type AirportDataset } from './data/airports.ts';
import { homeAirport, welcomeSuggestions, FALLBACK_HOME } from './data/suggestions.ts';
import { browserTimeZone, formatIsoInstant } from './lib/timezone.ts';
import { localizedCity } from './data/placeNames.ts';
import { buildSearchIndex, type SearchIndex } from './data/search.ts';
import type { GlobeRoute, Insets } from './globe/GlobeRenderer.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent.ts';
import { pushUrl, replaceUrl, trackEvent } from './analytics.ts';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { useVisualViewportVars } from './hooks/useVisualViewport.ts';
import { sumDurations } from './lib/flightTime.ts';

import { computeLayovers, computeLegs, hasEnteredTimes, type RouteAction } from './state/route.ts';
import {
  loadWaterNames,
  saveWaterNames,
  loadReduceMotion,
  saveReduceMotion,
  loadMyLocation,
  saveMyLocation,
  loadFollowAircraft,
  saveFollowAircraft,
  loadBorders,
  loadCountryNames,
  loadLastRoute,
  loadUnit,
  saveBorders,
  saveCountryNames,
  saveUnit,
  loadLastJourney,
  saveLastJourney,
  loadDayNight,
  saveDayNight,
  loadClockZone,
  saveClockZone,
} from './state/storage.ts';
import { resolveRouteCodes } from './state/url.ts';
import type { Airport, DistanceUnit, LocalTimeInput } from './types.ts';

const GlobeView = lazy(() => import('./globe/GlobeView.tsx'));

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Shared by the memoized welcome rows and asynchronous first-visit initialization. */
function suggestionsFor(index: SearchIndex, zones: TimeZoneTable | null) {
  const home = homeAirport(browserTimeZone(), { index, zones }) ?? index.iata.get(FALLBACK_HOME);
  return home ? welcomeSuggestions(home, index) : [];
}

/** Miles only for an English interface in a miles-using region; Hungarian and Swedish use kilometres. */
function defaultUnit(): DistanceUnit {
  // The i18n bootstrap sets <html lang> to the active locale before the first render.
  if (!document.documentElement.lang.startsWith('en')) return 'km';
  const lang = navigator.language || '';
  return /-(US|LR|MM)$/i.test(lang) ? 'mi' : 'km';
}

export default function App() {
  const { t, fmt, locale, cityNames, setVisitLocale } = useI18n();

  // Side panel on wide screens and landscape tablets; bottom sheet on phones and portrait tablets.
  const isDesktop = useMediaQuery('(min-width: 1000px), (min-width: 760px) and (orientation: landscape)');
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [reduceMotionPref, setReduceMotionPref] = useState(loadReduceMotion);
  const reducedMotion = effectiveReducedMotion(reduceMotionPref, systemReducedMotion);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduce' : 'full';
  }, [reducedMotion]);
  useVisualViewportVars();

  const [clock] = useState(() => new SimulationClock());
  const clockRef = useRef(clock);
  const mountedClock = useRef(false);
  useEffect(() => {
    mountedClock.current = true;
    const instance = clockRef.current;
    clock.goLive();
    return () => {
      mountedClock.current = false;
      queueMicrotask(() => {
        if (!mountedClock.current) instance.dispose();
      });
    };
  }, [clock]);
  const [zones, setZones] = useState<TimeZoneTable | null>(null);
  const [zonesLoaded, setZonesLoaded] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [assumedStart, setAssumedStart] = useState<number | null>(null);
  const [followAircraft, setFollowAircraft] = useState(() => loadFollowAircraft() ?? false);

  const [dayNight, setDayNight] = useState(() => loadDayNight() ?? true);
  const [clockZone, setClockZone] = useState<string>(() => loadClockZone() ?? 'local');
  const [linkLayers, setLinkLayers] = useState<Pick<LinkView, 'names' | 'borders'>>({});
  const [explicitDefaults, setExplicitDefaults] = useState<LinkDefaultKey[]>([]);
  const [linkUnits, setLinkUnits] = useState<DistanceUnit | null>(null);
  const [linkedTime, setLinkedTime] = useState<number | null>(null);
  const [pausedTime, setPausedTime] = useState<number | null>(null);
  const [speed, setSpeed] = useState(clock.getSnapshot().speed);
  const pendingView = useRef<LinkView | null>(null);
  const pendingExplicitPlay = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
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
  const [comparison, compareDispatch] = useReducer(compareReducer, undefined, createCompareState);
  const route = comparison.journeys[comparison.active].route;
  const comparing = comparison.journeys.length > 1;
  const dispatch = useCallback((action: RouteAction) => compareDispatch({ type: 'route', action }), []);
  // Only a newly added, unedited draft gets the copied-airports hint.
  const [copiedDraft, setCopiedDraft] = useState<{ index: number; airportIds: (number | null)[] } | null>(null);
  const routeStopCount = useRef(0);
  useLayoutEffect(() => {
    routeStopCount.current = route.stops.filter((stop) => stop.airportId !== null).length;
  }, [route.stops]);
  const [unit, setUnit] = useState<DistanceUnit>(() => loadUnit() ?? defaultUnit());
  const [showCountryNames, setShowCountryNames] = useState(() => loadCountryNames() ?? false);
  const [showWaterNames, setShowWaterNames] = useState(() => loadWaterNames() ?? loadCountryNames() ?? false);
  const [myLocation, setMyLocation] = useState(() => loadMyLocation() ?? false);
  const [showBorders, setShowBorders] = useState(() => loadBorders() ?? true);
  const [isExample, setIsExample] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  /** Edit mode: reorder, remove and insert stops, reverse or clear the route. */
  const [arranging, setArranging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fits, setFits] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const [globeFailed, setGlobeFailed] = useState(false);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  /** Height covered by the mobile sheet; floating globe controls sit just above it. */
  const [sheetInset, setSheetInset] = useState(0);
  /** Set when a layout change (collapsing the sheet for playback) should re-frame the globe once insets settle. */
  const refitAfterLayout = useRef(false);
  const { toast, showToast } = useToast();
  const locationAvailable = !globeFailed && 'geolocation' in navigator;
  const location = useGeolocation(myLocation && locationAvailable, (status: 'denied' | 'unavailable') => {
    setMyLocation(false);
    if (status === 'denied') saveMyLocation(false);
    showToast(t(status === 'denied' ? 'toasts.locationDenied' : 'toasts.locationUnavailable'));
  });

  const panelRef = useRef<HTMLElement>(null);
  const takeoverRef = useRef<AirportPickerHandle>(null);
  const aboutRef = useRef<AboutDialogHandle>(null);
  const analytics = useAnalyticsConsent();
  const indexRef = useRef<SearchIndex | null>(null);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const lookup = useCallback((id: number) => dataset?.byId.get(id), [dataset]);

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
        showToast(
          missing.length === 1
            ? t('toasts.unknownAirport', missing[0])
            : t('toasts.unknownAirports', missing.join(', ')),
        );
      }
    },
    [showToast, t],
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
        if (missing.length)
          notices.unshift(
            missing.length === 1
              ? t('toasts.unknownAirport', missing[0])
              : t('toasts.unknownAirports', missing.join(', ')),
          );
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
        const address = new URL(window.location.href);
        address.pathname = localizedPath(import.meta.env.BASE_URL, targetLocale);
        address.searchParams.delete('lang');
        replaceUrl(address.href);
      }
      const params = new URLSearchParams(search.toLowerCase());
      const encoded = [...new URLSearchParams(search)].find(([key]) => key.toLowerCase() === 'itinerary')?.[1];
      const decoded = encoded ? decodeItineraryParam(encoded) : null;
      const documentView = decoded?.ok ? decoded.doc.view : undefined;
      const hasView = (key: 'follow' | 'dayNight' | 'clock') =>
        params.has(key.toLowerCase()) || documentView?.[key] !== undefined;
      setExplicitDefaults((['follow', 'dayNight', 'clock'] as const).filter(hasView));
      setShowCountryNames(link.view.names ?? loadCountryNames() ?? false);
      setShowWaterNames(link.view.names ?? loadWaterNames() ?? loadCountryNames() ?? false);
      setShowBorders(link.view.borders ?? loadBorders() ?? true);
      setLinkLayers({ names: link.view.names, borders: link.view.borders });
      setFollowAircraft(hasView('follow') ? link.view.follow : (loadFollowAircraft() ?? false));
      setDayNight(hasView('dayNight') ? link.view.dayNight : (loadDayNight() ?? true));
      const linkedClock = !['local', 'utc'].includes(link.view.clock)
        ? resolveRouteCodes([link.view.clock], idx).stops[0]?.airport
        : undefined;
      setClockZone(
        hasView('clock') ? (linkedClock ? airportCode(linkedClock) : link.view.clock) : (loadClockZone() ?? 'local'),
      );
      setUnit(link.view.units ?? loadUnit() ?? defaultUnit());
      setLinkUnits(link.view.units);
      const open = !!(
        link.view.time !== null ||
        link.view.play ||
        [...(link.stops ?? []), ...(link.compare ?? []).flatMap((entry) => entry.stops)].some(
          (s) => s.arrival || s.departure,
        )
      );
      setTimeOpen(open);
      if (
        link.view.play &&
        !reducedMotionRef.current &&
        !window.matchMedia('(min-width: 1000px), (min-width: 760px) and (orientation: landscape)').matches
      )
        setCollapsed(true);
      setAssumedStart(open ? (link.view.time ?? Date.now()) : null);
      setPausedTime(link.view.time);
      setLinkedTime(link.view.time);
      clock.pause();
      clock.setSpeed(link.view.speed);
      clock.setRange(null, null);
      pendingView.current = open ? link.view : null;
      pendingExplicitPlay.current = false;
      if (!open) clock.goLive();
    },
    [clock, showToast, t, locale, setVisitLocale, dispatch],
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

  // ---- Load the airport dataset, then initialise the route (URL > remembered > example) ----
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
        indexRef.current = idx;
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
  }, [showToast]);

  // The mobile search takeover gets its own history entry so the Android/browser back
  // button closes it instead of leaving the site.
  const pickerEntry = useRef(false);
  const ignoreNextPop = useRef(false);
  const shareUrlRef = useRef('');
  const closeEditorRef = useRef<() => void>(() => {});

  // Back/forward navigation between shared links.
  useEffect(() => {
    const onPop = () => {
      if (ignoreNextPop.current) {
        // We stepped back over the picker entry ourselves; keep the current route in the URL.
        ignoreNextPop.current = false;
        replaceUrl(shareUrlRef.current, null);
        return;
      }
      if (pickerEntry.current) {
        pickerEntry.current = false;
        closeEditorRef.current();
        replaceUrl(shareUrlRef.current, null);
        return;
      }
      const idx = indexRef.current;
      const link = parseLink(window.location.search);
      if (idx) {
        if (link.stops === null) link.stops = [];
        applyLink(link, idx, window.location.search);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyLink]);

  const legs = useMemo(() => (dataset ? computeLegs(route.stops, lookup) : []), [route.stops, dataset, lookup]);
  const layovers = useMemo(() => computeLayovers(route.stops, legs), [route.stops, legs]);
  const serializedJourneys = useMemo(
    () =>
      comparison.journeys.map((draft) => ({
        label: draft.label,
        stops: draft.route.stops.flatMap<SerializableLinkStop>((stop) => {
          const airport = stop.airportId !== null ? lookup(stop.airportId) : undefined;
          return airport
            ? [{ airport, layoverMin: stop.layoverMin, arrival: stop.arrival, departure: stop.departure }]
            : [];
        }),
      })),
    [comparison.journeys, lookup],
  );
  const filledStops = serializedJourneys[comparison.active].stops;
  const primaryStops = serializedJourneys[0].stops;
  const linkExtra = useMemo(
    () => ({ label: serializedJourneys[0].label, compare: serializedJourneys.slice(1) }),
    [serializedJourneys],
  );
  const filledAirports = useMemo(() => filledStops.map((s) => s.airport), [filledStops]);
  const compared = useMemo(
    () =>
      computeComparison(
        serializedJourneys.map((entry, i) => ({
          label: entry.label,
          input: {
            id: JOURNEY_IDS[i],
            stops: entry.stops.map((stop) => ({ ...stop, zone: zoneForAirport(zones, stop.airport) })),
          },
        })),
        { assumedStart: timeOpen ? assumedStart : null },
      ),
    [serializedJourneys, zones, timeOpen, assumedStart],
  );
  const metrics = useMemo(() => compareMetrics(compared), [compared]);
  const scheduleErrors = compared.some((entry) => entry.journey.issues.some((issue) => issue.severity === 'error'));
  const journey = compared[comparison.active].journey;
  const timeline = compared[comparison.active].timeline;
  const range = useMemo(() => comparisonRange(compared), [compared]);
  const playbackRange = comparing ? range : timeline;
  const legOffsets = useMemo(() => journeyLegOffsets(compared), [compared]);
  const fleet = useMemo(
    () =>
      comparing
        ? compared.map((entry, i) => ({
            journey: entry.journey,
            timeline: entry.timeline,
            legOffset: legOffsets[i],
            color: entry.color,
            tag: entry.id,
          }))
        : undefined,
    [compared, comparing, legOffsets],
  );
  const phaseKey = useClockPhase(clock, journey, timeline, timeOpen);
  const playing = phaseKey.startsWith('playing:');
  const activeState = timeOpen && timeline ? journeyStateAt(journey, timeline, clock.getSnapshot().time) : null;
  const [simulation] = useState(() => {
    let context: SimulationContext = { journey, timeline, open: timeOpen, dayNight, follow: !reducedMotion };
    const feed = createSimulationFeed(clock, () => context);
    return {
      feed,
      updateContext(next: SimulationContext) {
        context = next;
        feed.refresh();
      },
    };
  });
  const sim = simulation.feed;
  useLayoutEffect(() => {
    simulation.updateContext({
      journey,
      timeline,
      open: timeOpen,
      dayNight,
      follow: !reducedMotion,
      fleet,
      primary: comparison.active,
    });
  }, [simulation, journey, timeline, timeOpen, dayNight, reducedMotion, fleet, comparison.active]);
  useEffect(() => {
    if (!timeOpen || !zonesLoaded) return;
    if (!playbackRange || scheduleErrors) clock.pause();
    clock.setRange(
      playbackRange ? Math.min(playbackRange.start - 30 * 60000, linkedTime ?? Infinity) : null,
      playbackRange ? Math.max(playbackRange.end, linkedTime ?? -Infinity) : null,
    );
    const view = pendingView.current;
    if (view) {
      pendingView.current = null;
      clock.seek(view.time ?? playbackRange?.start ?? Date.now());
      const shouldPlay = view.play && (pendingExplicitPlay.current || !reducedMotionRef.current);
      pendingExplicitPlay.current = false;
      if (shouldPlay && playbackRange && !scheduleErrors) {
        if (clock.getSnapshot().time >= playbackRange.end) clock.seek(playbackRange.start);
        clock.setRange(Math.min(playbackRange.start - 30 * 60000, linkedTime ?? Infinity), playbackRange.end);
        clock.play();
      }
    } else if (clock.getSnapshot().live) clock.seek(playbackRange?.start ?? Date.now());
  }, [clock, playbackRange, timeOpen, zonesLoaded, linkedTime, scheduleErrors]);
  // Debounce paused scrubs. Playback frames never cause App state updates or URL writes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const snapshot = clock.getSnapshot();
      if (snapshot.speed !== speed) setSpeed(snapshot.speed);
      if (snapshot.playing || !timeOpen) return;
      timer = setTimeout(() => setPausedTime(clock.getSnapshot().time), 450);
    };
    update();
    const unsubscribe = clock.subscribe(update);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [clock, timeOpen, speed]);

  // ---- Persist readable links and schedule, preserving mobile picker history ----
  const query = useMemo(
    () =>
      serializeLink(
        primaryStops,
        {
          time: timeOpen && !playing ? pausedTime : null,
          speed,
          clock: clockZone,
          units: linkUnits,
          dayNight,
          follow: followAircraft,
          names: linkLayers.names !== undefined ? showCountryNames : undefined,
          borders: linkLayers.borders !== undefined ? showBorders : undefined,
          leg:
            comparison.journeys[0].route.selectedLeg !== null
              ? comparison.journeys[0].route.selectedLeg + 1
              : undefined,
        },
        explicitDefaults,
        linkExtra,
      ),
    [
      primaryStops,
      linkExtra,
      comparison.journeys,
      timeOpen,
      playing,
      pausedTime,
      speed,
      clockZone,
      linkUnits,
      dayNight,
      followAircraft,
      linkLayers,
      showCountryNames,
      showBorders,
      explicitDefaults,
    ],
  );
  const shareUrl = window.location.origin + localizedPath(import.meta.env.BASE_URL, null) + query;
  const addressUrl = window.location.origin + window.location.pathname + query;
  useEffect(() => {
    shareUrlRef.current = addressUrl;
    if (!initialized) return;
    if (addressUrl !== window.location.href) replaceUrl(addressUrl);
    saveLastJourney(serializeLink(primaryStops, { speed }, false, linkExtra));
    document.title = comparing
      ? t(
          'compare.documentTitle',
          serializedJourneys
            .map((entry) => entry.stops.map((stop) => airportCode(stop.airport)).join(' → '))
            .join(', '),
        )
      : filledStops.length
        ? t('panel.routeTitle', filledStops.map((s) => airportCode(s.airport)).join(' → '))
        : t('common.documentTitle');
  }, [
    addressUrl,
    filledStops,
    primaryStops,
    linkExtra,
    comparing,
    serializedJourneys,
    initialized,
    speed,
    clockZone,
    dayNight,
    followAircraft,
    locale,
    t,
  ]);

  const getAgentContext = useMemo(() => {
    let cached: ReturnType<typeof createAgentContext> | null = null;
    return () =>
      (cached ??= dataset
        ? createAgentContext({
            airports: dataset,
            timezones: zones,
            baseUrl: window.location.origin + import.meta.env.BASE_URL,
          })
        : null);
  }, [dataset, zones]);
  useWebTools(initialized && zonesLoaded && !!dataset, async (name, args) => {
    const command = parseWebCommand(
      name,
      args,
      name === 'set_view' ? compared[0].journey.legs.length : journey.legs.length,
    );
    const snapshot = clock.getSnapshot();
    const currentView: LinkView = {
      time: timeOpen ? snapshot.time : null,
      play: snapshot.playing,
      speed: snapshot.speed,
      clock: clockZone,
      units: unit,
      dayNight,
      follow: followAircraft,
      names: showCountryNames,
      borders: showBorders,
      lang: locale,
      ...(route.selectedLeg !== null ? { leg: route.selectedLeg + 1 } : {}),
    };
    const currentLink = () => {
      const url = new URL(localizedPath(import.meta.env.BASE_URL, locale), window.location.origin);
      url.search = serializeLink(
        primaryStops,
        {
          ...currentView,
          lang: undefined,
          leg:
            comparison.journeys[0].route.selectedLeg !== null
              ? comparison.journeys[0].route.selectedLeg! + 1
              : undefined,
        },
        true,
        linkExtra,
      );
      // An explicit empty route must not reload the remembered journey.
      if (!primaryStops.length) url.searchParams.set('route', '');
      return url.href;
    };
    if (command.type === 'get_share_link') return { url: currentLink() };
    if (command.type === 'get_journey') {
      const doc = linkStateToDocument(
        parseLink(serializeLink(primaryStops, { ...currentView, leg: undefined }, false, linkExtra)),
      );
      const assumption = timeOpen ? { assumeDeparture: formatIsoInstant(assumedStart ?? snapshot.time) } : {};
      const comparisonPlan = comparing ? planComparison(getAgentContext()!, doc, assumption) : null;
      const activeDoc = { version: 1 as const, stops: (doc.journeys?.[comparison.active]?.stops ?? doc.stops)! };
      const plan = planItinerary(
        getAgentContext()!,
        activeDoc,
        !journey.dated && journey.start ? { assumeDeparture: formatIsoInstant(journey.start.epochMs) } : {},
      );
      return {
        ...(comparisonPlan
          ? {
              comparison: {
                journeys: comparisonPlan.journeys,
                comparison: comparisonPlan.comparison,
                url: currentLink(),
              },
            }
          : {}),
        contractVersion: plan.contractVersion,
        stops: plan.stops,
        legs: plan.legs,
        transfers: plan.transfers,
        totals: plan.totals,
        issues: plan.issues,
        valid: plan.valid,
        view: {
          ...currentView,
          time: new Date(snapshot.time).toISOString(),
          live: snapshot.live,
          leg: currentView.leg ?? null,
        },
        url: currentLink(),
      };
    }
    if (command.type === 'select_flight') {
      flushSync(() => {
        setFollowAircraft(false);
        dispatch({ type: 'selectLeg', leg: command.leg === null ? null : command.leg - 1 });
      });
      return { applied: true, leg: command.leg };
    }
    if (command.type === 'set_route') {
      const plan = command.link.stops?.length
        ? (command.link.compare?.length ? planComparison : planItinerary)(
            getAgentContext()!,
            linkStateToDocument(command.link),
          )
        : null;
      if (plan && !plan.valid)
        throw new TypeError(
          plan.issues
            .filter((i) => i.severity === 'error')
            .map((i) => `${i.path ?? i.code}: ${i.message}`)
            .join(' '),
        );
      if (command.link.view.lang) {
        const address = new URL(window.location.href);
        address.pathname = localizedPath(import.meta.env.BASE_URL, command.link.view.lang);
        replaceUrl(address.href);
      }
      flushSync(() => applyLink(command.link, index!, command.search));
      if (command.link.view.lang) await setVisitLocale(command.link.view.lang);
      return { applied: true, issues: plan?.issues ?? [] };
    }
    if (
      command.view.clock &&
      !['local', 'utc'].includes(command.view.clock) &&
      !serializedJourneys.some((entry) => entry.stops.some((s) => airportCode(s.airport) === command.view.clock))
    )
      throw new TypeError('clock must name an airport in this route, local or utc.');
    if (
      command.view.play &&
      (!compared.some((entry) => entry.journey.legs.length) ||
        compared.some((entry) => entry.journey.issues.some((issue) => issue.severity === 'error')))
    )
      throw new TypeError('Playback requires at least one flight and a valid schedule.');
    const patch = command.view;
    flushSync(() => {
      if (patch.follow !== undefined) setFollowAircraft(patch.follow);
      if (patch.dayNight !== undefined) setDayNight(patch.dayNight);
      if (patch.names !== undefined) {
        setShowCountryNames(patch.names);
        setShowWaterNames(patch.names);
        setLinkLayers((previous) => ({ ...previous, names: patch.names }));
      }
      if (patch.borders !== undefined) {
        setShowBorders(patch.borders);
        setLinkLayers((previous) => ({ ...previous, borders: patch.borders }));
      }
      if (patch.units !== undefined && patch.units !== null) {
        setUnit(patch.units);
        setLinkUnits(patch.units);
      }
      if (patch.clock !== undefined) setClockZone(patch.clock);
      if (patch.speed !== undefined) clock.setSpeed(patch.speed);
      if (patch.leg !== undefined) {
        if (patch.follow === undefined) setFollowAircraft(false);
        compareDispatch({ type: 'activate', index: 0 });
        compareDispatch({ type: 'route', index: 0, action: { type: 'selectLeg', leg: patch.leg - 1 } });
        setEditing(null);
      }
      setExplicitDefaults((previous) => [
        ...new Set([
          ...previous,
          ...(['follow', 'dayNight', 'clock'] as const).filter((key) => patch[key] !== undefined),
        ]),
      ]);
      if (patch.time !== undefined || patch.play !== undefined) {
        if (!timeOpen) {
          setAssumedStart(patch.time ?? Date.now());
          setTimeOpen(true);
        }
        if (patch.time !== undefined) {
          setLinkedTime(patch.time);
          setPausedTime(patch.time);
        }
        pendingView.current = { ...currentView, ...patch };
        pendingExplicitPlay.current = patch.play === true;
        if (patch.play === false) clock.pause();
        // A view patch can leave the timeline unchanged, so apply it directly when already open.
        if (timeOpen) {
          pendingView.current = null;
          if (patch.time !== undefined && patch.time !== null) {
            clock.setRange(
              Math.min(playbackRange?.start ?? Infinity, patch.time),
              Math.max(playbackRange?.end ?? -Infinity, patch.time),
            );
            clock.seek(patch.time);
          }
          if (patch.play) clock.play();
        }
      }
    });
    if (patch.lang) {
      const address = new URL(window.location.href);
      address.pathname = localizedPath(import.meta.env.BASE_URL, patch.lang);
      address.searchParams.delete('lang');
      replaceUrl(address.href);
      await setVisitLocale(patch.lang);
    }
    return { applied: true };
  });

  // ---- Globe data ----
  const globeRoute = useMemo<GlobeRoute>(
    () => comparisonGlobeRoute(compared, comparison.active, timeOpen, fmt.city),
    [compared, comparison.active, timeOpen, fmt],
  );

  // ---- Layout insets: tell the globe which parts of the screen are covered by UI ----
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // On phones the open time bar is part of the sheet, so the sheet alone covers the bottom of the globe.
    const measure = () => {
      const r = panel.getBoundingClientRect();
      const sheet = Math.max(0, Math.round(window.innerHeight - r.top));
      setSheetInset((prev) => (Math.abs(prev - sheet) < 2 ? prev : sheet));
      const next: Insets = isDesktop
        ? { top: 0, right: 0, bottom: 0, left: Math.round(r.right) }
        : { top: 56, right: 0, bottom: sheet + 8, left: 0 };
      setInsets((prev) =>
        Math.abs(prev.left - next.left) < 2 && Math.abs(prev.bottom - next.bottom) < 2 && prev.top === next.top
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isDesktop, collapsed, editing, route.stops, route.selectedLeg, timeOpen, initialized, arranging]);

  useEffect(() => {
    if (!refitAfterLayout.current) return;
    refitAfterLayout.current = false;
    setFitNonce((n) => n + 1);
  }, [insets]);

  // ---- Editing ----
  const focusTakeover = () => {
    if (isDesktop) return;
    if (!pickerEntry.current) {
      pickerEntry.current = true;
      pushUrl(window.location.href, { globehopsPicker: true });
    }
    takeoverRef.current?.reset();
    // Focus synchronously inside the user gesture so iOS raises the keyboard.
    takeoverRef.current?.focus();
  };

  const openEditor = (i: number) => {
    flushSync(() => setEditing(i));
    focusTakeover();
  };

  const addStop = (at?: number) => {
    const target = at ?? route.stops.length;
    flushSync(() => {
      dispatch(at === undefined ? { type: 'addStop' } : { type: 'insertStop', index: at });
      setIsExample(false);
      setEditing(target);
    });
    focusTakeover();
  };

  const focusStopButton = (i: number) => {
    requestAnimationFrame(() => {
      const btn = panelRef.current?.querySelectorAll<HTMLButtonElement>('.stop__main')[i];
      btn?.focus({ preventScroll: false });
    });
  };

  const releasePickerEntry = () => {
    if (!pickerEntry.current) return;
    pickerEntry.current = false;
    ignoreNextPop.current = true;
    window.history.back();
  };

  const closeEditor = (opts: { cancelled: boolean }) => {
    const i = editing;
    setEditing(null);
    releasePickerEntry();
    if (i === null) return;
    // Cancelling a freshly added, still-empty intermediate stop removes it again.
    if (opts.cancelled && route.stops[i]?.airportId === null && route.stops.length > 2) {
      dispatch({ type: 'removeStop', index: i });
      return;
    }
    if (isDesktop) focusStopButton(i);
  };

  const onSelectAirport = (a: Airport) => {
    if (editing === null) return;
    const i = editing;
    dispatch({ type: 'setAirport', index: i, airportId: a.id });
    setIsExample(false);
    // Continue to the next empty stop (e.g. From → To) without closing the keyboard.
    const stops = route.stops.map((s, k) => (k === i ? { ...s, airportId: a.id } : s));
    let next = stops.findIndex((s, k) => k > i && s.airportId === null);
    if (next === -1) next = stops.findIndex((s) => s.airportId === null);
    if (next !== -1) {
      setEditing(next);
      takeoverRef.current?.reset();
    } else {
      setEditing(null);
      releasePickerEntry();
      if (isDesktop) focusStopButton(i);
    }
  };

  const changeFollowAircraft = (on: boolean) => {
    setFollowAircraft(on);
    saveFollowAircraft(on);
  };

  const changeUnit = (u: DistanceUnit) => {
    setUnit(u);
    if (linkUnits !== null) setLinkUnits(u);
    saveUnit(u);
  };

  const toggleCountryNames = () => {
    setShowCountryNames((on) => {
      saveCountryNames(!on);
      return !on;
    });
  };

  const toggleBorders = () => {
    setShowBorders((on) => {
      saveBorders(!on);
      return !on;
    });
  };

  const share = async () => {
    const url = shareUrl;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const title = filledAirports.map(airportCode).join(' → ');
    if (coarse && navigator.share) {
      try {
        await navigator.share({ title: t('panel.routeTitle', title), url });
        trackEvent('share', { method: 'share_sheet', content_type: 'journey' });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('toasts.linkCopied'));
      trackEvent('share', { method: 'copy_link', content_type: 'journey' });
    } catch {
      showToast(t('toasts.copyLink'), url);
    }
  };

  const selectLeg = (leg: number | null) => {
    if (followAircraft) changeFollowAircraft(false);
    dispatch({ type: 'selectLeg', leg });
    if (timeOpen && leg !== null && journey.legs[leg]?.departure) clock.seek(journey.legs[leg].departure!.epochMs);
  };
  const editLeg = (leg: number) => {
    selectLeg(leg);
    setCollapsed(false);
  };
  const openTime = () => {
    setAssumedStart(Date.now());
    setTimeOpen(true);
  };
  const closeTime = () => {
    setTimeOpen(false);
    setPausedTime(null);
    setLinkedTime(null);
    clock.setRange(null, null);
    clock.goLive();
  };
  const togglePlayback = () => {
    if (!timeOpen || !clock.getSnapshot().playing) trackEvent('play_journey', { flights: legs.length });
    if (!timeOpen) {
      openTime();
      pendingExplicitPlay.current = true;
      pendingView.current = {
        time: playbackRange?.start ?? null,
        play: true,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
        follow: followAircraft,
      };
    } else if (playbackRange && !scheduleErrors) {
      if (!clock.getSnapshot().playing && clock.getSnapshot().time >= playbackRange.end)
        clock.seek(playbackRange.start);
      if (!clock.getSnapshot().playing)
        clock.setRange(Math.min(playbackRange.start - 30 * 60000, linkedTime ?? Infinity), playbackRange.end);
      clock.toggle();
    }
    if (!isDesktop && !playing && (!timeOpen || playbackRange) && !collapsed) {
      refitAfterLayout.current = !followAircraft;
      setCollapsed(true);
    }
  };
  const changeTime = (stop: number, field: 'arrival' | 'departure', value: LocalTimeInput | null) => {
    const original = route.stops.map((s, i) => (s.airportId !== null ? i : -1)).filter((i) => i !== -1)[stop];
    if (original !== undefined) dispatch({ type: 'setTime', index: original, field, value });
    setIsExample(false);
  };
  const reverse = () => {
    if (hasEnteredTimes(route.stops)) showToast(t('toasts.reversedTimes'));
    dispatch({ type: 'reverse' });
    setIsExample(false);
  };
  const clear = () => {
    dispatch({ type: 'clear' });
    setIsExample(false);
    setArranging(false);
    if (isDesktop) setEditing(0);
  };
  const toggleArranging = () => {
    if (!arranging && route.selectedLeg !== null) selectLeg(null);
    setArranging((on) => !on);
  };

  const editingCount = route.stops.length;
  /** Plain-text props for the picker of stop i (handlers are passed inline). */
  const pickerText = (i: number) => {
    const current = route.stops[i]?.airportId;
    const airport = current !== null && current !== undefined ? lookup(current) : undefined;
    return {
      label: fmt.stopLabel(i, editingCount),
      caption: fmt.stopCaption(i, editingCount),
      placeholder: airport ? t('picker.replace', airportCode(airport)) : fmt.stopPlaceholder(i, editingCount),
    };
  };
  const cancelEditor = () => closeEditor({ cancelled: true });
  useEffect(() => {
    closeEditorRef.current = () => setEditing(null);
  });

  const fastestJourney = compared.find((entry) => entry.id === metrics.fastest);
  const comparisonAnnouncement = fastestJourney
    ? t(
        'compare.announcement',
        compared.length,
        fastestJourney.id,
        fmt.duration(fastestJourney.journey.totals.journeyMin),
      )
    : t('compare.comparing', compared.length);
  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const flightMin = journey.dated ? journey.totals.flightMin : sumDurations(legs.map((l) => l.durationMin));
  const totalMin = journey.dated
    ? journey.totals.journeyMin
    : flightMin
      ? flightMin + layovers.reduce((s, l) => s + l.minutes, 0)
      : 0;
  const estimated =
    !journey.dated ||
    journey.legs.some((l) => l.departure?.provenance !== 'entered' || l.arrival?.provenance !== 'entered');
  const sheetCollapsed = !isDesktop && collapsed && editing === null;
  const sheet = useBottomSheet(panelRef, {
    enabled: !isDesktop,
    collapsed: sheetCollapsed,
    setCollapsed,
    reducedMotion,
  });
  // Phones with the timeline docked: the totals scroll with the list so the stops keep some room.
  const summaryInList = !isDesktop && timeOpen;
  const activateJourney = (index: number) => {
    setEditing(null);
    compareDispatch({ type: 'activate', index });
  };
  const addJourney = () => {
    setEditing(null);
    setIsExample(false);
    compareDispatch({ type: 'add' });
    setCopiedDraft({
      index: comparison.journeys.length,
      airportIds: [filledAirports[0]?.id ?? null, filledAirports.at(-1)?.id ?? null],
    });
    trackEvent('compare_journeys');
  };
  const showCopiedHint =
    copiedDraft?.index === comparison.active &&
    route.stops.length === 2 &&
    !hasEnteredTimes(route.stops) &&
    route.stops.every((stop, i) => stop.airportId !== null && stop.airportId === copiedDraft.airportIds[i]);
  const summary = comparing ? (
    <CompareSummary
      list={compared}
      metrics={metrics}
      active={comparison.active}
      onActivate={activateJourney}
      onPlay={togglePlayback}
      timeOpen={timeOpen}
    />
  ) : (
    legs.length > 0 && (
      <Summary
        journey={journey}
        onCheckLeg={editLeg}
        legs={legs}
        layovers={layovers}
        unit={unit}
        action={
          timeOpen ? null : (
            <button type="button" className="play-btn" aria-label={t('panel.play')} onClick={togglePlayback}>
              <IconPlay size={18} />
              <span>{t('panel.play')}</span>
            </button>
          )
        }
      />
    )
  );
  const canArrange = filledAirports.length > 0 || route.stops.length > 2;
  const timeBar = (docked: boolean) => (
    <TimeBar
      clock={clock}
      journey={journey}
      timeline={timeline}
      comparison={comparing ? compared : undefined}
      active={comparison.active}
      onActivate={activateJourney}
      onEditJourneyLeg={(index, leg) => {
        activateJourney(index);
        compareDispatch({ type: 'route', index, action: { type: 'selectLeg', leg } });
        setCollapsed(false);
      }}
      clockZone={clockZone}
      docked={docked}
      followAircraft={followAircraft}
      onFollowAircraft={globeFailed ? undefined : changeFollowAircraft}
      onClockZone={(value) => {
        setClockZone(value);
        if (value === 'local' || value === 'utc') saveClockZone(value);
      }}
      onClose={closeTime}
      onToggle={togglePlayback}
      onEditLeg={editLeg}
    />
  );

  return (
    <div className={`app ${isDesktop ? 'layout-desktop' : 'layout-mobile'}`}>
      <div className={`stage${globeReady ? ' is-ready' : ''}`}>
        {globeFailed ? (
          <div className="globe-fallback" role="note">
            <p className="globe-fallback__title">{t('errors.globeTitle')}</p>
            <p>{t('errors.noWebGL')}</p>
          </div>
        ) : (
          <ErrorBoundary
            onError={(e) => {
              console.error(e);
              setGlobeFailed(true);
            }}
          >
            <Suspense fallback={null}>
              <GlobeView
                sim={sim}
                followAircraft={followAircraft}
                onFollowAircraftChange={changeFollowAircraft}
                route={globeRoute}
                selectedLeg={route.selectedLeg === null ? null : legOffsets[comparison.active] + route.selectedLeg}
                insets={insets}
                showBorders={showBorders}
                showCountryNames={showCountryNames}
                showWaterNames={showWaterNames}
                userLocation={location.position}
                locale={locale}
                reducedMotion={reducedMotion}
                fitNonce={fitNonce}
                onLegClick={(globalLeg) => {
                  const target = localLegAt(compared, globalLeg);
                  if (!target) return;
                  if (target.index === comparison.active)
                    selectLeg(route.selectedLeg === target.leg ? null : target.leg);
                  else {
                    activateJourney(target.index);
                    if (followAircraft) changeFollowAircraft(false);
                    compareDispatch({
                      type: 'route',
                      index: target.index,
                      action: { type: 'selectLeg', leg: target.leg },
                    });
                    const departure = compared[target.index].journey.legs[target.leg]?.departure;
                    if (timeOpen && departure) clock.seek(departure.epochMs);
                  }
                }}
                onFitChange={setFits}
                onReady={() => setGlobeReady(true)}
                onError={(e) => {
                  console.error(e);
                  setGlobeFailed(true);
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      <header className="topbar">
        <h1 className="sr-only">GlobeHops</h1>
        <Brand />
        <button
          type="button"
          className="float-btn"
          aria-label={t('panel.aboutGlobeHops')}
          onClick={() => aboutRef.current?.open()}
        >
          <IconInfo />
        </button>
      </header>

      {initialized && analytics.available && analytics.consent === null && (
        <ConsentNotice onChoose={analytics.choose} onDetails={() => aboutRef.current?.open('privacy')} />
      )}

      {initialized && (
        <MapTools
          clock={clock}
          globe={!globeFailed}
          showWaterNames={showWaterNames}
          reducedMotion={reducedMotion}
          myLocation={myLocation}
          locationAvailable={locationAvailable}
          onToggleWaterNames={() => {
            saveWaterNames(!showWaterNames);
            setShowWaterNames(!showWaterNames);
          }}
          onToggleReduceMotion={() => {
            saveReduceMotion(!reducedMotion);
            setReduceMotionPref(!reducedMotion);
          }}
          onToggleMyLocation={() => {
            saveMyLocation(!myLocation);
            setMyLocation(!myLocation);
          }}
          showBorders={showBorders}
          showCountryNames={showCountryNames}
          dayNight={dayNight}
          unit={unit}
          timeOpen={timeOpen}
          frameLabel={
            legs.length
              ? route.selectedLeg !== null
                ? t('panel.reCentreOnThisFlight')
                : t('panel.reCentreOnTheRoute')
              : null
          }
          onToggleBorders={toggleBorders}
          onToggleCountryNames={toggleCountryNames}
          onToggleDayNight={() =>
            setDayNight((on) => {
              saveDayNight(!on);
              return !on;
            })
          }
          onUnitChange={changeUnit}
          onOpenTime={openTime}
          onFit={() => setFitNonce((n) => n + 1)}
        />
      )}

      {((isDesktop && timeOpen) || (!globeFailed && !timeOpen)) && (
        <div
          className={`hud-wrap${isDesktop && timeOpen ? ' has-timeline' : ''}`}
          style={
            {
              '--inset-left': `${insets.left}px`,
              '--inset-bottom': `${isDesktop ? insets.bottom : sheetInset}px`,
            } as React.CSSProperties
          }
        >
          {isDesktop && timeOpen && timeBar(false)}
          {!globeFailed && !timeOpen && (
            <GlobeHud legs={legs} selectedLeg={route.selectedLeg} fits={fits} onSelectLeg={selectLeg} />
          )}
        </div>
      )}

      <main
        ref={panelRef}
        className={`panel${comparison.journeys.length >= 3 ? ' has-many-journeys' : ''}${sheetCollapsed ? ' is-collapsed' : ''}${!isDesktop && timeOpen ? ' has-timeline' : ''}`}
        aria-label={t('panel.journeyPlanner')}
      >
        {!isDesktop && (
          <button
            type="button"
            className="sheet-handle"
            aria-expanded={!sheetCollapsed}
            aria-label={sheetCollapsed ? t('panel.showJourneyDetails') : t('panel.hideJourneyDetails')}
            onClick={() => (sheetCollapsed ? sheet.expand() : sheet.collapse())}
          >
            <span />
          </button>
        )}

        {!isDesktop && timeOpen && timeBar(true)}

        {sheetCollapsed ? (
          !timeOpen && (
            <button
              type="button"
              className="peek"
              onClick={() => sheet.expand()}
              aria-label={t('panel.showJourneyDetails')}
            >
              <span className="peek__route">
                {filledAirports.length ? filledAirports.map(airportCode).join(' → ') : t('panel.planAJourney')}
              </span>
              {legs.length > 0 && (
                <span className="peek__totals">
                  {fmt.distance(totalKm, unit)}
                  {totalMin ? ` · ${estimated ? '≈ ' : ''}${fmt.duration(totalMin)}` : ''}
                </span>
              )}
              <IconChevronUp size={18} className="peek__chev" />
            </button>
          )
        ) : (
          <>
            <div className="panel__head">
              <h2 className="panel__title">
                {comparing ? (
                  t('compare.title')
                ) : isExample ? (
                  <>
                    {t('panel.exampleJourney')}
                    <span className="panel__hint">{t('panel.chooseAnyAirportToChangeIt')}</span>
                  </>
                ) : filledAirports.length ? (
                  t('panel.yourJourney')
                ) : (
                  t('panel.planAJourney')
                )}
              </h2>
              <div className="panel__actions">
                {canArrange && (
                  <button
                    type="button"
                    className={`head-btn${arranging ? ' is-on' : ''}`}
                    aria-pressed={arranging}
                    onClick={toggleArranging}
                  >
                    {arranging ? <IconCheck size={17} /> : <IconPencil size={16} />}
                    <span>{arranging ? t('panel.done') : t('panel.edit')}</span>
                  </button>
                )}
                {filledAirports.length > 0 && (
                  <button type="button" className="head-btn" onClick={share}>
                    <IconShare size={17} />
                    <span>{t('panel.share')}</span>
                  </button>
                )}
              </div>
            </div>

            {comparing && (
              <JourneyTabs list={compared} active={comparison.active} onActivate={activateJourney} onAdd={addJourney} />
            )}
            <div
              role={comparing ? 'tabpanel' : undefined}
              id={comparing ? 'journey-panel' : undefined}
              aria-labelledby={comparing ? `journey-tab-${compared[comparison.active].id}` : undefined}
              className={`panel__scroll${isExample && !arranging ? ' suggestions--welcome' : ''}`}
            >
              {dataError ? (
                <p className="panel__error" role="alert">
                  {t('errors.airportsUnavailable')}
                </p>
              ) : (
                <>
                  {comparing && showCopiedHint && (
                    <p className="compare-hint">{t('compare.copiedHint', compared[comparison.active].id)}</p>
                  )}
                  <StopList
                    key={comparison.journeys[comparison.active].key}
                    journeyColor={comparing ? compared[comparison.active].color : undefined}
                    journey={journey}
                    activeLeg={activeState?.phase === 'flight' ? activeState.leg : null}
                    activeStop={activeState?.phase === 'transfer' ? activeState.stop : null}
                    onTimeChange={changeTime}
                    stops={route.stops}
                    legs={legs}
                    layovers={layovers}
                    lookup={lookup}
                    unit={unit}
                    selectedLeg={route.selectedLeg}
                    editing={isDesktop ? editing : null}
                    arranging={arranging}
                    renderPicker={(i) => (
                      <AirportPicker
                        key={route.stops[i].key}
                        variant="inline"
                        index={index}
                        {...pickerText(i)}
                        onSelect={onSelectAirport}
                        onCancel={cancelEditor}
                      />
                    )}
                    onEdit={openEditor}
                    onRemove={(i) => {
                      dispatch({ type: 'removeStop', index: i });
                      setIsExample(false);
                    }}
                    onInsert={(i) => addStop(i)}
                    onAdd={() => addStop()}
                    onMove={(from, to) => {
                      dispatch({ type: 'moveStop', from, to });
                      setIsExample(false);
                    }}
                    onLayoverChange={(index, minutes) => {
                      dispatch({ type: 'setLayover', index, minutes });
                      setIsExample(false);
                    }}
                    onSelectLeg={selectLeg}
                    onReverse={reverse}
                    onClear={clear}
                  />
                  {(comparing || (!isExample && legs.length > 0)) && (
                    <div className="itinerary__actions">
                      {comparing ? (
                        <button
                          type="button"
                          className="row row--action compare-remove"
                          onClick={() => {
                            setEditing(null);
                            compareDispatch({ type: 'remove', index: comparison.active });
                            setCopiedDraft(null);
                          }}
                        >
                          <span aria-hidden="true" />
                          <span className="row__icon">
                            <IconTrash size={16} />
                          </span>
                          <span>{t('compare.remove', compared[comparison.active].id)}</span>
                        </button>
                      ) : (
                        <button type="button" className="row row--action compare-entry" onClick={addJourney}>
                          <span aria-hidden="true" />
                          <span className="row__icon">
                            <IconCompare size={17} />
                          </span>
                          <span>{t('compare.entry')}</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {initialized && !comparing && (isExample || filledAirports.length === 0) && (
                <div className="suggestions">
                  <p className="suggestions__title" id="welcome-suggestions-title">
                    {t(isExample ? 'panel.tryOneOfThese' : 'panel.orTryOneOfThese')}
                  </p>
                  <ul role="list" aria-labelledby="welcome-suggestions-title">
                    {suggestions.map(({ from, to, minutes }) => (
                      <li key={to.id}>
                        <button
                          type="button"
                          className="suggestion"
                          aria-pressed={
                            isExample &&
                            filledAirports.length === 2 &&
                            filledAirports[0].id === from.id &&
                            filledAirports[1].id === to.id
                          }
                          onClick={() =>
                            index && loadCodes([airportCode(from), airportCode(to)], index, { example: true })
                          }
                        >
                          <IconPlane size={14} />
                          <span className="suggestion__route">
                            {fmt.city(from)} → {fmt.city(to)}
                          </span>
                          <span className="suggestion__duration">≈ {fmt.duration(minutes)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summaryInList && summary}
              <footer className="panel__foot">
                <button type="button" className="credits" onClick={() => aboutRef.current?.open()}>
                  {t('panel.credits')}
                </button>
              </footer>
            </div>

            {!summaryInList && summary}
          </>
        )}
      </main>

      {!isDesktop && editing !== null && (
        <div className="takeover" role="dialog" aria-modal="true" aria-label={fmt.stopLabel(editing, editingCount)}>
          <AirportPicker
            ref={takeoverRef}
            variant="takeover"
            index={index}
            {...pickerText(editing)}
            onSelect={onSelectAirport}
            onCancel={cancelEditor}
          />
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {initialized ? (comparing ? comparisonAnnouncement : fmt.describeRoute(legs, layovers, unit)) : ''}
      </p>
      <p className="sr-only" aria-live="polite">
        {activeState ? fmt.describeState(journey, activeState).title : ''}
      </p>
      {isDesktop && <VersionTag />}
      <Toast toast={toast} />
      <AboutDialog ref={aboutRef} meta={dataset?.meta ?? null} analytics={analytics} />
    </div>
  );
}
