import { useI18n } from './i18n/I18nProvider.tsx';
import { localizedPath } from './i18n/detect.ts';
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
import { IconCheck, IconChevronUp, IconInfo, IconPencil, IconShare, IconPlay } from './components/Icons.tsx';
import { MapTools } from './components/MapTools.tsx';
import { StopList } from './components/StopList.tsx';
import { Summary } from './components/Summary.tsx';
import { TimeBar } from './components/TimeBar.tsx';
import { Toast } from './components/Toast.tsx';
import { useToast } from './hooks/useToast.ts';
import { useBottomSheet } from './hooks/useBottomSheet.ts';

import timezonesUrl from './data/generated/timezones.json?url';
import { loadTimeZones, zoneForAirport, type TimeZoneTable } from './data/timezones.ts';
import { computeJourney } from './lib/schedule.ts';
import { buildTimeline, journeyStateAt } from './lib/timeline.ts';

import { SimulationClock } from './state/clock.ts';
import { createSimulationFeed, type SimulationContext } from './state/simulation.ts';
import { useClockPhase } from './hooks/useClock.ts';
import { parseLink, serializeLink, type LinkState, type LinkView, type SerializableLinkStop } from './state/link.ts';
import airportsUrl from './data/generated/airports.json?url';
import { airportCode, displayCode, loadAirports, type AirportDataset } from './data/airports.ts';
import { buildSearchIndex, type SearchIndex } from './data/search.ts';
import type { GlobeRoute, Insets } from './globe/GlobeRenderer.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent.ts';
import { pushUrl, replaceUrl, trackEvent } from './analytics.ts';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { useVisualViewportVars } from './hooks/useVisualViewport.ts';
import { sumDurations } from './lib/flightTime.ts';
import { legColor } from './lib/legColors.ts';

import { computeLayovers, computeLegs, createRouteState, routeReducer, hasEnteredTimes } from './state/route.ts';
import {
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

const EXAMPLE_ROUTE = ['CPH', 'LHR', 'JFK'];
const SUGGESTED_ROUTES = [
  ['CPH', 'YYZ'],
  ['SYD', 'LAX'],
  ['LHR', 'DXB', 'SIN', 'SYD'],
  ['MMX', 'ARN', 'HEL', 'NRT'],
];
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function defaultUnit(): DistanceUnit {
  const lang = navigator.language || '';
  return /-(US|LR|MM)$/i.test(lang) ? 'mi' : 'km';
}

export default function App() {
  const { t, fmt, locale } = useI18n();

  // Side panel on wide screens and landscape tablets; bottom sheet on phones and portrait tablets.
  const isDesktop = useMediaQuery('(min-width: 1000px), (min-width: 760px) and (orientation: landscape)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
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
  const [dayNight, setDayNight] = useState(() => loadDayNight() ?? true);
  const [clockZone, setClockZone] = useState<string>(() => loadClockZone() ?? 'local');
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
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [dataError, setDataError] = useState(false);
  const [route, dispatch] = useReducer(routeReducer, undefined, () => createRouteState());
  const [unit, setUnit] = useState<DistanceUnit>(() => loadUnit() ?? defaultUnit());
  const [showCountryNames, setShowCountryNames] = useState(() => loadCountryNames() ?? false);
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

  const panelRef = useRef<HTMLElement>(null);
  const takeoverRef = useRef<AirportPickerHandle>(null);
  const aboutRef = useRef<AboutDialogHandle>(null);
  const analytics = useAnalyticsConsent();
  const indexRef = useRef<SearchIndex | null>(null);

  const lookup = useCallback((id: number) => dataset?.byId.get(id), [dataset]);

  /** Loads route tokens (codes with optional layovers) into the route, reporting unknown codes. */
  const loadCodes = useCallback(
    (codes: string[], idx: SearchIndex, opts: { example?: boolean } = {}) => {
      const { stops, missing } = resolveRouteCodes(codes, idx);
      dispatch({
        type: 'load',
        airportIds: stops.map((s) => s.airport.id),
        layovers: stops.map((s) => s.layoverMin),
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
      const notices = locale === 'en' ? [...link.issues] : link.issues.length ? [t('errors.invalidLink')] : [];
      if (link.stops !== null) {
        const missing: string[] = [];
        const resolved = link.stops.flatMap((stop) => {
          const result = resolveRouteCodes([stop.code], idx);
          if (!result.stops.length) {
            missing.push(stop.code);
            return [];
          }
          return [{ ...stop, airport: result.stops[0].airport }];
        });
        dispatch({
          type: 'load',
          airportIds: resolved.map((s) => s.airport.id),
          layovers: resolved.map((s) => s.layoverMin),
          arrivals: resolved.map((s) => s.arrival),
          departures: resolved.map((s) => s.departure),
        });
        setIsExample(false);
        if (missing.length)
          notices.unshift(
            missing.length === 1
              ? t('toasts.unknownAirport', missing[0])
              : t('toasts.unknownAirports', missing.join(', ')),
          );
      }
      if (notices.length) showToast(notices.join(' '));
      const params = new URLSearchParams(search.toLowerCase());
      const itinerary = params.has('itinerary');
      setDayNight(params.has('daynight') || itinerary ? link.view.dayNight : (loadDayNight() ?? true));
      setClockZone(params.has('clock') || itinerary ? link.view.clock : (loadClockZone() ?? 'local'));
      setUnit(link.view.units ?? loadUnit() ?? defaultUnit());
      setLinkUnits(link.view.units);
      const open = !!(link.view.time !== null || link.view.play || link.stops?.some((s) => s.arrival || s.departure));
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
    [clock, showToast, t, locale],
  );

  const zoneLoadError = useEffectEvent(() => showToast(t('toasts.zonesUnavailable')));
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
    return () => ctrl.abort();
  }, [showToast]);

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
        loadCodes(legacy ?? EXAMPLE_ROUTE, idx, { example: legacy === null });
      }
      // A view-only link still overrides the remembered/default view.
      if (window.location.search) applyLink(fromUrl, idx, window.location.search);
    }
    setInitialized(true);
  });

  // ---- Load the airport dataset, then initialise the route (URL > remembered > example) ----
  useEffect(() => {
    const ctrl = new AbortController();
    loadAirports(airportsUrl, ctrl.signal)
      .then((data) => {
        const idx = buildSearchIndex(data.airports);
        indexRef.current = idx;
        setDataset(data);
        setIndex(idx);
        initializeRoute(idx);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setDataError(true);
      });
    return () => ctrl.abort();
  }, []);

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
  const filledStops = useMemo(
    () =>
      route.stops.flatMap<SerializableLinkStop>((s) => {
        const airport = s.airportId !== null ? lookup(s.airportId) : undefined;
        return airport ? [{ airport, layoverMin: s.layoverMin, arrival: s.arrival, departure: s.departure }] : [];
      }),
    [route.stops, lookup],
  );
  const filledAirports = useMemo(() => filledStops.map((s) => s.airport), [filledStops]);

  const journey = useMemo(
    () =>
      computeJourney(
        { id: 'A', stops: filledStops.map((s) => ({ ...s, zone: zoneForAirport(zones, s.airport) })) },
        { assumedStart: timeOpen && !filledStops.some((s) => s.arrival || s.departure) ? assumedStart : null },
      ),
    [filledStops, zones, timeOpen, assumedStart],
  );
  const timeline = useMemo(() => buildTimeline(journey), [journey]);
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
    simulation.updateContext({ journey, timeline, open: timeOpen, dayNight, follow: !reducedMotion });
  }, [simulation, journey, timeline, timeOpen, dayNight, reducedMotion]);
  useEffect(() => {
    if (!timeOpen || !zonesLoaded) return;
    if (!timeline) clock.pause();
    clock.setRange(
      timeline ? Math.min(timeline.start - 30 * 60000, linkedTime ?? Infinity) : null,
      timeline ? Math.max(timeline.end, linkedTime ?? -Infinity) : null,
    );
    const view = pendingView.current;
    if (view) {
      pendingView.current = null;
      clock.seek(view.time ?? timeline?.start ?? Date.now());
      const shouldPlay = view.play && (pendingExplicitPlay.current || !reducedMotionRef.current);
      pendingExplicitPlay.current = false;
      if (shouldPlay && timeline) {
        if (clock.getSnapshot().time >= timeline.end) clock.seek(timeline.start);
        clock.setRange(Math.min(timeline.start - 30 * 60000, linkedTime ?? Infinity), timeline.end);
        clock.play();
      }
    } else if (clock.getSnapshot().live) clock.seek(timeline?.start ?? Date.now());
  }, [clock, timeline, timeOpen, zonesLoaded, linkedTime]);
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
      serializeLink(filledStops, {
        time: timeOpen && !playing ? pausedTime : null,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
      }),
    [filledStops, timeOpen, playing, pausedTime, speed, clockZone, linkUnits, dayNight],
  );
  const shareUrl = window.location.origin + localizedPath(import.meta.env.BASE_URL, null) + query;
  const addressUrl = window.location.origin + window.location.pathname + query;
  useEffect(() => {
    shareUrlRef.current = addressUrl;
    if (!initialized) return;
    if (addressUrl !== window.location.href) replaceUrl(addressUrl);
    saveLastJourney(serializeLink(filledStops, { speed, clock: clockZone, dayNight }));
    document.title = filledStops.length
      ? t('panel.routeTitle', filledStops.map((s) => airportCode(s.airport)).join(' → '))
      : t('common.documentTitle');
  }, [addressUrl, filledStops, initialized, speed, clockZone, dayNight, locale, t]);

  // ---- Globe data ----
  const globeRoute = useMemo<GlobeRoute>(() => {
    const markers: GlobeRoute['markers'] = [];
    const seen = new Map<number, number>();
    filledAirports.forEach((a, i) => {
      const role =
        filledAirports.length === 1
          ? 'single'
          : i === 0
            ? 'origin'
            : i === filledAirports.length - 1
              ? 'destination'
              : 'transfer';
      const existing = seen.get(a.id);
      if (existing !== undefined) {
        // Round trips: keep one marker; origin wins over destination.
        if (markers[existing].role === 'transfer') markers[existing].role = role;
        return;
      }
      seen.set(a.id, markers.length);
      markers.push({
        key: String(a.id),
        code: displayCode(a) ?? (fmt.city(a).length > 16 ? `${fmt.city(a).slice(0, 15)}…` : fmt.city(a)),
        lat: a.lat,
        lng: a.lng,
        role,
      });
    });
    const counts = new Map<string, number>();
    const globeLegs = legs.map((l, i) => {
      const base = `${l.from.id}>${l.to.id}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return { key: `${base}#${n}`, from: l.from, to: l.to, color: legColor(i) };
    });
    return { markers, legs: globeLegs };
  }, [filledAirports, legs, fmt]);

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
        time: journey.start?.epochMs ?? null,
        play: true,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
      };
    } else if (timeline) {
      if (!clock.getSnapshot().playing && clock.getSnapshot().time >= timeline.end) clock.seek(timeline.start);
      if (!clock.getSnapshot().playing)
        clock.setRange(Math.min(timeline.start - 30 * 60000, linkedTime ?? Infinity), timeline.end);
      clock.toggle();
    }
    if (!isDesktop && !playing && (!timeOpen || timeline) && !collapsed) {
      refitAfterLayout.current = true;
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
  const summary = legs.length > 0 && (
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
  );
  const canArrange = filledAirports.length > 0 || route.stops.length > 2;
  const timeBar = (docked: boolean) => (
    <TimeBar
      clock={clock}
      journey={journey}
      timeline={timeline}
      clockZone={clockZone}
      docked={docked}
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
                route={globeRoute}
                selectedLeg={route.selectedLeg}
                insets={insets}
                showBorders={showBorders}
                showCountryNames={showCountryNames}
                reducedMotion={reducedMotion}
                fitNonce={fitNonce}
                onLegClick={(leg) => selectLeg(route.selectedLeg === leg ? null : leg)}
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
        className={`panel${sheetCollapsed ? ' is-collapsed' : ''}${!isDesktop && timeOpen ? ' has-timeline' : ''}`}
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
                {isExample ? (
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

            <div className="panel__scroll">
              {dataError ? (
                <p className="panel__error" role="alert">
                  {t('errors.airportsUnavailable')}
                </p>
              ) : (
                <StopList
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
                  onRemove={(i) => dispatch({ type: 'removeStop', index: i })}
                  onInsert={(i) => addStop(i)}
                  onAdd={() => addStop()}
                  onMove={(from, to) => dispatch({ type: 'moveStop', from, to })}
                  onLayoverChange={(index, minutes) => dispatch({ type: 'setLayover', index, minutes })}
                  onSelectLeg={selectLeg}
                  onReverse={reverse}
                  onClear={clear}
                />
              )}
              {initialized && legs.length === 0 && filledAirports.length === 0 && (
                <div className="suggestions">
                  <p className="suggestions__title">{t('panel.orTryOneOfThese')}</p>
                  <ul>
                    {SUGGESTED_ROUTES.map((s) => (
                      <li key={s.join('-')}>
                        <button type="button" className="suggestion" onClick={() => index && loadCodes(s, index)}>
                          {s
                            .map((code) => {
                              const airport = dataset?.airports.find((a) => a.iata === code);
                              return airport ? fmt.city(airport) : code;
                            })
                            .join(' → ')}
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
        {initialized ? fmt.describeRoute(legs, layovers, unit) : ''}
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
