import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import { flushSync } from 'react-dom';

import { AboutDialog, type AboutDialogHandle } from './components/AboutDialog.tsx';
import { AiImportDialog, AiImportEntry, type AiImportDialogHandle } from './components/AiImportDialog.tsx';
import { RouteImportDialog, RouteImportEntry, type RouteImportDialogHandle } from './components/RouteImportDialog.tsx';
import { AirportPicker, type AirportPickerHandle } from './components/AirportPicker.tsx';
import { Brand, VersionTag } from './components/Brand.tsx';
import { CollapsedJourneyPeek } from './components/CollapsedJourneyPeek.tsx';
import { CompareSummary } from './components/CompareSummary.tsx';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlobeHud } from './components/GlobeHud.tsx';
import { IconInfo, IconCompare, IconImport, IconReturn, IconTrack, IconTrash } from './components/Icons.tsx';
import { JourneyPanelHeader } from './components/JourneyPanelHeader.tsx';
import { JourneyTabs } from './components/JourneyTabs.tsx';
import { MapTools } from './components/MapTools.tsx';
import { PlayLauncher } from './components/PlayLauncher.tsx';
import { StopList } from './components/StopList.tsx';
import { Summary } from './components/Summary.tsx';
import { StayLine, TripSummary } from './components/TripSummary.tsx';
import { TripCompareSummary } from './components/TripCompareSummary.tsx';
import { SectionSwitch } from './components/SectionSwitch.tsx';
import { NameField } from './components/NameField.tsx';
import { tripCaptions, tripCodes, tripColumnNames } from './components/tripCompareText.ts';
import { sectionNames } from './components/tripText.ts';
import { TimeBar } from './components/TimeBar.tsx';
import { TimeDial } from './components/TimeDial.tsx';
import { Toast } from './components/Toast.tsx';
import { RouteSuggestions, type SuggestedRoute } from './components/RouteSuggestions.tsx';
import { DESKTOP_MEDIA_QUERY } from './hooks/appMedia.ts';
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent.ts';
import { opensWithRoute, useAppLinks } from './hooks/useAppLinks.ts';
import { useAppWebTools } from './hooks/useAppWebTools.ts';
import { useBottomSheet } from './hooks/useBottomSheet.ts';
import { useClockPhase } from './hooks/useClock.ts';
import { useGeolocation } from './hooks/useGeolocation.ts';
import { useJourneyAddressWithReduction } from './hooks/useJourneyAddress.ts';
import { useJourneyModel } from './hooks/useJourneyModel.ts';
import { useJourneyPlayback, usePlaybackRange } from './hooks/useJourneyPlayback.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { usePanelInsets } from './hooks/usePanelInsets.ts';
import { usePickerHistory } from './hooks/usePickerHistory.ts';
import { useToast } from './hooks/useToast.ts';
import { useViewPreferences } from './hooks/useViewPreferences.ts';
import { useRouting } from './hooks/useRouting.ts';
import { DEFAULT_DIVERSION_PROFILE } from './lib/diversion.ts';
import { useVisualViewportVars } from './hooks/useVisualViewport.ts';
import type { GlobeRoute } from './globe/GlobeRenderer.ts';
import { useI18n } from './i18n/I18nProvider.tsx';
import { trackEvent } from './analytics.ts';
import { airportCode } from './data/airports.ts';
import { findAirportByCode } from './data/search.ts';
import { groupFlights } from './lib/import/group.ts';
import type { ImportContext, ImportResult } from './lib/import/types.ts';
import { exportFileName, tracksToGeoJson, type ExportedFlight } from './lib/trackExport.ts';
import { estimateRoute, similarRoutes } from './data/similarRoutes.ts';
import { comparisonGlobeRoute } from './lib/compareView.ts';
import { tripComparisonGlobeRoute, tripGlobeRoute, tripRouteCodes } from './lib/tripView.ts';
import { tripComparisonSkips } from './lib/compareTrips.ts';
import { MAX_SECTIONS, stayPlaybackSkips, tripStateAt } from './lib/trip.ts';
import { MAX_JOURNEYS } from './lib/compare.ts';
import type { LegRouter } from './lib/compare.ts';
import { sumDurations } from './lib/flightTime.ts';
import { comparisonPreview, journeyPreview, tripPreview } from './lib/playPreview.ts';
import { journeyStateAt } from './lib/timeline.ts';
import { createPlanState, planKind, planReducer, planShape } from './state/plan.ts';
import { playInRange } from './state/playbackRange.ts';
import { hasEnteredTimes, type RouteAction } from './state/route.ts';
import { createSimulationFeed, type SimulationContext } from './state/simulation.ts';
import { loadPlayed, savePlayed } from './state/storage.ts';
import type { Airport, LocalTimeInput } from './types.ts';

const GlobeView = lazy(() => import('./globe/GlobeView.tsx'));

/** Whether keyboard focus is on one of the full timeline's controls (the scrubber, a menu, a button). */
function keyboardInTimeline(): boolean {
  const focused = document.activeElement;
  return !!focused?.closest('.time-bar:not(.time-bar--compact)') && focused.matches(':focus-visible');
}

export default function App() {
  const { t, fmt, locale, setVisitLocale } = useI18n();

  // Side panel on wide screens and landscape tablets; bottom sheet on phones and portrait tablets.
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  /** A mouse or trackpad: the launcher can mention that Space plays. */
  const finePointer = useMediaQuery('(pointer: fine)');
  /** Landscape phones: the side panel spans the screen's height, so its totals scroll with the list. */
  const shortScreen = useMediaQuery('(max-height: 560px)');
  const preferences = useViewPreferences();
  const {
    unit,
    showCountryNames,
    showWaterNames,
    showBorders,
    followAircraft,
    dayNight,
    clockZone,
    myLocation,
    reducedMotion,
    linkUnits,
    changeFollowAircraft,
    changeUnit,
    toggleCountryNames,
    toggleBorders,
  } = preferences;
  useVisualViewportVars();

  const [plan, planDispatch] = useReducer(planReducer, undefined, createPlanState);
  const route = plan.journeys[plan.active].route;
  /** The active journey follows an imported path on at least one flight. */
  const hasTracks = route.stops.some((stop) => stop.track);
  const kind = planKind(plan);
  const comparing = kind === 'compare';
  const tripMode = kind === 'trip';
  /** Alternative trips (A–D), each the same journeys, e.g. out and back. */
  const comparingTrips = kind === 'compareTrips';
  const shape = planShape(plan);
  const dispatch = useCallback((action: RouteAction) => planDispatch({ type: 'route', action }), []);
  /** In a trip, the journey playback is limited to; null plays the whole trip. */
  const [playScope, setPlayScope] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  /** Edit mode: reorder, remove and insert stops, reverse or clear the route. */
  const [arranging, setArranging] = useState(false);
  /** Without a route to show, phones open on the globe and its clock, with the planner one tap away. */
  const [startsEmpty] = useState(() => !opensWithRoute());
  const [collapsed, setCollapsedState] = useState(() => startsEmpty && !window.matchMedia(DESKTOP_MEDIA_QUERY).matches);
  /** Phones: the sheet at nearly full height, for editing a journey that does not fit beside the globe. */
  const [sheetFull, setSheetFull] = useState(false);
  /** Whether editing (rather than the visitor's own drag) grew the sheet, so finishing returns it to half. */
  const autoFull = useRef(false);
  /** Collapsing the sheet also ends its full height: it opens at half height next time. */
  const setCollapsed = useCallback((next: SetStateAction<boolean>) => {
    setCollapsedState(next);
    if (next === true) {
      setSheetFull(false);
      autoFull.current = false;
    }
  }, []);
  const [fits, setFits] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [moonNonce, setMoonNonce] = useState(0);
  /** Until a first Play in this browser, the launcher's disc gives one gentle cue. */
  const [playCue, setPlayCue] = useState(() => loadPlayed() !== true);
  const [globeReady, setGlobeReady] = useState(false);
  const [globeFailed, setGlobeFailed] = useState(false);
  /** Set when a layout change (collapsing the sheet for playback) should re-frame the globe once insets settle. */
  const refitAfterLayout = useRef(false);
  const { toast, showToast } = useToast();
  const locationAvailable = !globeFailed && 'geolocation' in navigator;
  const location = useGeolocation(myLocation && locationAvailable, (status: 'denied' | 'unavailable') => {
    preferences.disableLocation(status === 'denied');
    showToast(t(status === 'denied' ? 'toasts.locationDenied' : 'toasts.locationUnavailable'));
  });

  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const takeoverRef = useRef<AirportPickerHandle>(null);
  const aboutRef = useRef<AboutDialogHandle>(null);
  const aiRef = useRef<AiImportDialogHandle>(null);
  const importRef = useRef<RouteImportDialogHandle>(null);
  /** Desktop: a file dragged over the app, to import as a flight path. */
  const [fileOver, setFileOver] = useState(false);
  const analytics = useAnalyticsConsent();
  const playback = useJourneyPlayback(reducedMotion, setCollapsed);
  const { clock, timeOpen, assumedStart, linkedTime, pausedTime, speed, applyView, openTime, closeTime } = playback;
  const { dataset, zones, zonesLoaded, index, suggestions, dataError, initialized, lookup, loadCodes, applyLink } =
    useAppLinks({
      route,
      planDispatch,
      setEditing,
      resetPreferences: preferences.resetToLink,
      applyView,
      showToast,
    });

  const { focusTakeover, releasePickerEntry, updatePickerAddress, focusStopButton } = usePickerHistory({
    isDesktop,
    index,
    applyLink,
    setEditing,
    takeoverRef,
    panelRef,
  });

  const { avoidAirspace, diversionRouting } = preferences;
  const routing = useRouting(avoidAirspace, diversionRouting);
  const router = routing.router;
  // Both off passes no router, so every flight is exactly its great circle, as before either existed.
  // Unknown airlines are treated as EU/EEA operators, the most restricted case (see data/AIRSPACE.md).
  const legRouter = useMemo<LegRouter | undefined>(
    () =>
      router && (avoidAirspace || diversionRouting)
        ? (from, to, departureMs) =>
            router.route(from, to, {
              epochMs: departureMs,
              avoidAirspace,
              diversion: diversionRouting ? DEFAULT_DIVERSION_PROFILE : null,
            })
        : undefined,
    [router, avoidAirspace, diversionRouting],
  );
  const model = useJourneyModel(plan, { dataset, zones, lookup }, timeOpen, assumedStart, legRouter);
  const {
    legs,
    layovers,
    filledAirports,
    compared,
    trip,
    trips,
    tripMetrics,
    tripsTimeline,
    metrics,
    journey,
    timeline,
    playbackRange,
    scheduleErrors,
    legOffsets,
    fleet,
    serializedJourneys,
  } = model;
  const names = useMemo(() => (trip ? sectionNames(trip, { t, fmt }) : []), [trip, t, fmt]);
  /** Compared trips: each trip's journey names, what tells the trips apart, and the journeys they share. */
  const tripNames = useMemo(() => trips?.map((entry) => sectionNames(entry.trip, { t, fmt })) ?? [], [trips, t, fmt]);
  const captions = useMemo(() => (trips ? tripCaptions(trips, { t, fmt }) : []), [trips, t, fmt]);
  const columns = useMemo(() => (trips ? tripColumnNames(trips, { t, fmt }) : []), [trips, t, fmt]);
  const activeTrip = trips?.[shape.option] ?? null;
  /**
   * Compared trips' journey names: every trip has the same journeys, so they share the column names
   * (Outbound, Return, …) unless a later journey has its own; the trip's name is the first journey's label.
   */
  const sectionTitles = useMemo(
    () =>
      tripNames.map((own, o) =>
        own.map((name, k) => (k > 0 ? plan.journeys[o * shape.sections + k]?.label : null) ?? columns[k] ?? name),
      ),
    [tripNames, plan.journeys, shape.sections, columns],
  );
  // A trip plays whole, or one journey of it on request; a missing journey falls back to the whole trip.
  const scope = timeOpen && trip && playScope !== null && playScope < trip.sections.length ? playScope : null;
  const scopedRange = trip ? (scope !== null ? trip.sections[scope].timeline : trip.timeline) : playbackRange;
  const phaseKey = useClockPhase(clock, journey, timeline, timeOpen, trip ?? activeTrip?.trip ?? null);
  const playing = phaseKey.startsWith('playing:');
  const live = phaseKey.startsWith('live:');
  // The globe's own clock is live with the timeline closed; watching means a journey's timeline is running.
  const watching = timeOpen && (playing || live);
  /** While a journey plays, the visitor asked for the full controls; every new Play starts cinematic again. */
  const [controlsShown, setControlsShown] = useState(false);
  const [wasWatching, setWasWatching] = useState(watching);
  if (watching !== wasWatching) {
    setWasWatching(watching);
    // A keyboard user playing from inside the timeline keeps it (and their focus); otherwise Play is cinematic.
    if (watching) setControlsShown(keyboardInTimeline());
  }
  /**
   * Cinematic playback: while a journey plays, the globe gets the screen and the timeline shrinks to a mini
   * player. Pausing, Show controls, Escape or lifting the phone sheet brings everything back.
   */
  const cinematic = watching && !controlsShown && !globeFailed && (isDesktop || (collapsed && editing === null));
  const activeState = (() => {
    if (!timeOpen) return null;
    const time = clock.getSnapshot().time;
    if (trip?.timeline) {
      const state = tripStateAt(trip, trip.timeline, time);
      return state.phase === 'journey' && state.section === plan.active ? state.state : null;
    }
    if (activeTrip) {
      const state = activeTrip.trip.timeline ? tripStateAt(activeTrip.trip, activeTrip.trip.timeline, time) : null;
      return state?.phase === 'journey' && state.section === shape.section ? state.state : null;
    }
    return timeline ? journeyStateAt(journey, timeline, time) : null;
  })();
  // Any journey's flights, not just the active one's, give the timeline something to show; without
  // flights, the time dial shows the globe at any moment instead.
  const hasFlights = trip
    ? trip.totals.flights > 0
    : trips
      ? trips.some((entry) => entry.trip.totals.flights > 0)
      : compared.some((entry) => entry.journey.legs.length > 0);
  const timeBarShown = timeOpen && hasFlights;
  // An empty start shows the dial straight away rather than once the airports have loaded.
  const dialShown = (initialized || startsEmpty) && !globeFailed && !hasFlights;
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
      // The trip or journey being edited is the one the camera follows.
      primary: trips ? shape.option : plan.active,
      trip: trip ? { trip, timeline: trip.timeline } : undefined,
    });
  }, [simulation, journey, timeline, timeOpen, dayNight, reducedMotion, fleet, plan.active, trip, trips, shape.option]);
  usePlaybackRange(playback, scopedRange, zonesLoaded, scheduleErrors);
  // A whole trip skips its stays while playing; one journey, or any other timeline, plays straight through.
  // Compared trips skip only the stays every traveller shares.
  const skips = useMemo(
    () =>
      !timeOpen
        ? []
        : trip?.timeline && scope === null
          ? stayPlaybackSkips(trip.timeline)
          : tripsTimeline
            ? tripComparisonSkips(tripsTimeline)
            : [],
    [timeOpen, trip, scope, tripsTimeline],
  );
  useEffect(() => clock.setSkips(skips), [clock, skips]);
  /** Closing the timeline also ends a journey-only playback, so the next one starts from the whole trip. */
  const closeTimeline = () => {
    setPlayScope(null);
    closeTime();
  };

  const { shareUrl, shareReduction } = useJourneyAddressWithReduction({
    model,
    preferences,
    plan,
    timeOpen,
    playing,
    live,
    pausedTime,
    speed,
    initialized,
    updatePickerAddress,
  });

  /** Every journey in plan order (alternative by alternative), matching `legOffsets`. */
  const flatJourneys = useMemo(
    () =>
      trip
        ? trip.sections.map((s) => s.journey)
        : trips
          ? trips.flatMap((entry) => entry.trip.sections.map((s) => s.journey))
          : compared.map((entry) => entry.journey),
    [trip, trips, compared],
  );
  const globeRoute = useMemo<GlobeRoute>(
    () =>
      trip
        ? tripGlobeRoute(trip, plan.active, timeOpen, fmt.city)
        : trips
          ? tripComparisonGlobeRoute(trips, shape.option, timeOpen, fmt.city)
          : comparisonGlobeRoute(compared, plan.active, timeOpen, fmt.city),
    [trip, trips, compared, plan.active, shape.option, timeOpen, fmt],
  );

  const { insets, sheetInset } = usePanelInsets(panelRef, {
    isDesktop,
    collapsed,
    editing,
    stops: route.stops,
    selectedLeg: route.selectedLeg,
    timeOpen,
    initialized,
    arranging,
    cinematic,
    floating:
      isDesktop && (!shortScreen || cinematic)
        ? dialShown
          ? 'dial'
          : timeBarShown
            ? 'timeline'
            : hasFlights
              ? 'launcher'
              : null
        : null,
    // A full sheet covers the globe; keep its framing for when the sheet comes back down.
    frozen: !isDesktop && sheetFull && !collapsed,
  });

  useEffect(() => {
    if (!refitAfterLayout.current) return;
    refitAfterLayout.current = false;
    setFitNonce((n) => n + 1);
  }, [insets]);

  /** Without a globe to look at, the planner is the whole app, so the sheet opens. */
  const failGlobe = (error: unknown) => {
    console.error(error);
    setGlobeFailed(true);
    setCollapsed(false);
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

  const share = async () => {
    const url = shareUrl;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const title = trip
      ? tripRouteCodes(trip.sections.map((s) => s.journey.stops.map((stop) => stop.airport)))
      : trips
        ? trips.map(tripCodes).filter(Boolean).join(' · ')
        : filledAirports.map(airportCode).join(' → ');
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
      showToast(
        shareReduction
          ? `${t('toasts.linkCopied')}. ${t('track.shareReduced', fmt.number(shareReduction.kept), fmt.number(shareReduction.total))}`
          : t('toasts.linkCopied'),
      );
      trackEvent('share', { method: 'copy_link', content_type: 'journey' });
    } catch {
      showToast(t('toasts.copyLink'), url);
    }
  };

  const selectLeg = (leg: number | null) => {
    if (followAircraft) changeFollowAircraft(false);
    dispatch({ type: 'selectLeg', leg });
    const departure = leg !== null ? journey.legs[leg]?.departure : null;
    if (timeOpen && departure) clock.seek(departure.epochMs);
  };
  /** Phones: grows the sheet to full height for an edit, returning it to half when the edit ends. */
  const growForEditing = () => {
    if (isDesktop || sheetFull) return;
    sheet.goTo('full');
    // After the move: moving the sheet otherwise records the visitor's own choice of height.
    autoFull.current = true;
  };
  const endEditing = () => {
    if (!autoFull.current) return;
    autoFull.current = false;
    if (sheetFull && !collapsed) sheet.goTo('half');
  };
  const editLeg = (leg: number) => {
    selectLeg(leg);
    if (isDesktop) return;
    if (collapsed) setCollapsed(false);
    growForEditing();
  };
  /** The list's flight rows open and close their times editor; on phones it gets the sheet's full height. */
  const selectListLeg = (leg: number | null) => {
    selectLeg(leg);
    if (leg === null) {
      if (!arranging) endEditing();
    } else growForEditing();
  };
  /** The first Play in this browser retires the launcher's cue for good. */
  const markPlayed = () => {
    if (!playCue) return;
    setPlayCue(false);
    savePlayed(true);
  };
  const togglePlayback = () => {
    if (!timeOpen || !clock.getSnapshot().playing) trackEvent('play_journey', { flights: legs.length });
    markPlayed();
    if (!timeOpen) {
      openTime();
      playback.requestPlayback({
        time: scopedRange?.start ?? null,
        play: true,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
        follow: followAircraft,
      });
    } else if (scopedRange && !scheduleErrors) {
      if (clock.getSnapshot().playing) clock.pause();
      else playInRange(clock, scopedRange, linkedTime);
    }
    if (!isDesktop && !playing && (!timeOpen || scopedRange) && !collapsed) {
      refitAfterLayout.current = !followAircraft;
      setCollapsed(true);
    }
  };
  // Space (or K) plays and pauses from anywhere outside a field or control, like a video player.
  const shortcutRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    shortcutRef.current = () => {
      if (hasFlights && !scheduleErrors) togglePlayback();
    };
  });
  const cinematicRef = useRef(cinematic);
  useLayoutEffect(() => {
    cinematicRef.current = cinematic;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      // Escape brings the controls back during cinematic playback.
      if (e.key === 'Escape' && cinematicRef.current) {
        setControlsShown(true);
        return;
      }
      if (e.key !== ' ' && e.key.toLowerCase() !== 'k') return;
      const target = e.target instanceof Element ? e.target : null;
      const inGlobe = !!target?.closest('.stage');
      if (target && target !== document.body && !inGlobe) return;
      if (document.querySelector('dialog[open], .takeover')) return;
      e.preventDefault();
      shortcutRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Plays a trip whole (null) or one of its journeys from its start, whatever is playing now. */
  const playTripScope = (next: number | null) => {
    if (!trip) return;
    markPlayed();
    const range = next === null ? trip.timeline : trip.sections[next]?.timeline;
    if (!range || scheduleErrors) {
      togglePlayback();
      return;
    }
    trackEvent('play_journey', {
      flights: next === null ? trip.totals.flights : trip.sections[next].journey.legs.length,
    });
    if (next !== null && next !== plan.active) activateJourney(next);
    const request = () =>
      playback.requestPlayback({
        time: range.start,
        play: true,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
        follow: followAircraft,
      });
    if (!timeOpen) {
      setPlayScope(next);
      openTime();
      request();
    } else if (next !== scope) {
      // The new range re-runs the playback effect, which seeks and plays the pending request.
      setPlayScope(next);
      request();
    } else {
      clock.seek(range.start);
      playInRange(clock, range, linkedTime);
    }
    if (!isDesktop && !collapsed) {
      refitAfterLayout.current = !followAircraft;
      setCollapsed(true);
    }
  };
  /** Shows the globe at a chosen moment; the first one opens the timeline so links keep the time. */
  const exploreTime = (time: number) => {
    if (!timeOpen) openTime();
    clock.seek(time);
  };
  /**
   * Live follows the wall clock. With flights, it tracks them in real time from the timeline, with the
   * camera following the aircraft; without, the globe simply shows now, as it does with the timeline closed.
   */
  const changeLive = (on: boolean) => {
    if (!on) exploreTime(clock.getSnapshot().time);
    else if (!hasFlights) closeTimeline();
    else {
      playback.goLive();
      if (!globeFailed && !followAircraft) changeFollowAircraft(true);
      if (!isDesktop && !collapsed) setCollapsed(true);
      trackEvent('live_journey', { flights: legs.length });
    }
  };
  const changeTime = (stop: number, field: 'arrival' | 'departure', value: LocalTimeInput | null) => {
    const original = route.stops.map((s, i) => (s.airportId !== null ? i : -1)).filter((i) => i !== -1)[stop];
    if (original !== undefined) dispatch({ type: 'setTime', index: original, field, value });
  };
  const reverse = () => {
    if (hasEnteredTimes(route.stops)) showToast(t('toasts.reversedTimes'));
    dispatch({ type: 'reverse' });
  };
  /** Start over: one empty journey, no compared journeys, times or open timeline. Preferences stay. */
  const resetJourney = () => {
    planDispatch({ type: 'load', journeys: [] });
    setArranging(false);
    if (timeOpen) closeTimeline();
    if (isDesktop) setEditing(0);
    else {
      setEditing(null);
      focusStopButton(0);
    }
  };
  const toggleArranging = () => {
    if (!arranging && route.selectedLeg !== null) selectLeg(null);
    if (arranging) endEditing();
    else growForEditing();
    setArranging((on) => !on);
  };

  /** Airports for matching an imported path's ends; ready with the dataset and its search index. */
  const importContext = useMemo<ImportContext | null>(
    () =>
      dataset && index
        ? { airports: dataset.airports, byCode: (code: string) => findAirportByCode(index, code) ?? undefined }
        : null,
    [dataset, index],
  );
  /** A journey draft as the plan reloads it, custom paths included. */
  const loadedDraft = (draft: (typeof plan.journeys)[number]) => ({
    label: draft.label,
    stayMin: draft.stayMin,
    airportIds: draft.route.stops.map((stop) => stop.airportId),
    layovers: draft.route.stops.map((stop) => stop.layoverMin),
    arrivals: draft.route.stops.map((stop) => stop.arrival),
    departures: draft.route.stops.map((stop) => stop.departure),
    tracks: draft.route.stops.map((stop) => stop.track?.track ?? null),
  });
  /** Whether an import could join the journeys on the globe as another one to compare. */
  const canCompareImport =
    (kind === 'single' && filledAirports.length >= 2) || (comparing && compared.length < MAX_JOURNEYS);
  /**
   * Imported flights become the visitor's plan: flights that connect form one journey, and an open jaw starts
   * the next journey of a trip. Compared, the import joins the journeys on the globe as another one.
   */
  const importFlights = (result: ImportResult, mode: 'replace' | 'compare') => {
    const { journeys } = groupFlights(result.flights);
    if (!journeys.length) return;
    const loaded = journeys.map((flights) => ({
      label: journeys.length === 1 ? result.name : null,
      airportIds: [flights[0].from.id, ...flights.map((flight) => flight.to.id)],
      tracks: flights.map((flight) => flight.track),
    }));
    setEditing(null);
    setArranging(false);
    if (timeOpen) closeTimeline();
    if (mode === 'compare' && canCompareImport) {
      const current = plan.journeys.map(loadedDraft);
      planDispatch({ type: 'load', journeys: [...current, loaded[0]] });
      planDispatch({ type: 'activate', index: current.length });
    } else planDispatch({ type: 'load', journeys: loaded, trip: loaded.length > 1 });
    if (!isDesktop && collapsed) setCollapsed(false);
    setFitNonce((n) => n + 1);
    showToast(t('import.done', result.name ?? t('summary.flights', fmt.number(result.flights.length))));
    trackEvent('route_import_use', { mode, flights: result.flights.length });
  };
  useAppWebTools({
    importFlights,
    canCompareImport,
    dataset,
    zones,
    index,
    initialized,
    zonesLoaded,
    preferences,
    plan,
    model,
    playback,
    setEditing,
    dispatch,
    planDispatch,
    applyLink,
    locale,
    setVisitLocale,
  });
  /** The active journey's custom paths, with the airports they fly between. */
  const trackedFlights = (): ExportedFlight[] =>
    journey.legs.flatMap((leg) => {
      const track = route.stops[leg.fromStop]?.track?.track;
      return track ? [{ from: leg.from, to: leg.to, track }] : [];
    });
  /** An imported path beside GlobeHops' own route between the same airports, on one clock. */
  const compareWithGenerated = () => {
    const current = loadedDraft(plan.journeys[0]);
    setEditing(null);
    setArranging(false);
    planDispatch({
      type: 'load',
      journeys: [
        current,
        { ...current, tracks: undefined, arrivals: undefined, departures: undefined, label: t('track.labelGenerated') },
      ],
    });
    trackEvent('compare_journeys');
  };
  /** Drops the active journey's custom paths: its flights follow GlobeHops' routes again. */
  const useGeneratedPaths = () =>
    route.stops.forEach((stop, index) => {
      if (stop.track) dispatch({ type: 'setTrack', index, track: null });
    });
  /** Every point of the active journey's custom paths, as a GeoJSON file. */
  const downloadPaths = () => {
    const flights = trackedFlights();
    if (!flights.length) return;
    const name = flights[0].track.source.name;
    const blob = new Blob([JSON.stringify(tracksToGeoJson(flights, name))], { type: 'application/geo+json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = exportFileName(flights, name);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    trackEvent('route_export');
  };
  // An installed app opened with a flight file (“Open with GlobeHops”) imports it once airports are ready.
  const launchedFile = useRef<File | null>(null);
  const importReady = importContext !== null;
  const importReadyRef = useRef(importReady);
  useLayoutEffect(() => {
    importReadyRef.current = importReady;
  });
  useEffect(() => {
    const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer(async (params) => {
      const file = await params.files?.[0]?.getFile();
      if (!file) return;
      if (importReadyRef.current) importRef.current?.open({ file });
      else launchedFile.current = file;
    });
  }, []);
  useEffect(() => {
    if (!importReady || !launchedFile.current) return;
    importRef.current?.open({ file: launchedFile.current });
    launchedFile.current = null;
  }, [importReady]);
  // Pasting a path or a route anywhere outside a field offers to import it.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"], dialog')) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim() || text.length > 20_000_000) return;
      void import('./lib/import/index.ts').then(({ looksLikeRoute }) => {
        if (looksLikeRoute(text)) importRef.current?.open({ text });
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  /** A chosen suggestion becomes the visitor's journey; bring its stops and actions into view. */
  const chooseSuggestion = ({ airports }: SuggestedRoute) => {
    if (!index) return;
    loadCodes(airports.map(airportCode), index);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }));
  };

  const editingCount = route.stops.length;
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
  const tripsAnnouncement = trips ? t('trips.comparing', fmt.number(trips.length)) : '';
  const comparisonAnnouncement = t('compare.comparing', compared.length);
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
    detent: sheetCollapsed ? 'peek' : sheetFull ? 'full' : 'half',
    onDetent: (detent) => {
      // The visitor's own choice of height outlasts the edit that may have grown the sheet.
      autoFull.current = false;
      setCollapsed(detent === 'peek');
      setSheetFull(detent === 'full');
    },
    reducedMotion,
    peek: timeBarShown ? (cinematic ? 'cinema' : 'timeline') : hasFlights ? 'launcher' : dialShown ? 'dial' : 'route',
  });
  // On phones the totals scroll with the list (the launcher above it carries the route and its time),
  // so the sheet's height goes to the journey; short landscape screens do the same in the side panel.
  const summaryInList = !isDesktop || shortScreen;
  const activateJourney = (index: number) => {
    setEditing(null);
    planDispatch({ type: 'activate', index });
  };
  /** Compared trips: another trip keeps the journey (outbound, return) being edited, and vice versa. */
  const activateTrip = (option: number) => activateJourney(option * shape.sections + shape.section);
  const activateSection = (section: number) => activateJourney(shape.option * shape.sections + section);
  const addJourney = () => {
    setEditing(null);
    planDispatch({ type: 'add' });
    listRef.current?.scrollTo({ top: 0 });
    trackEvent('compare_journeys');
  };
  /** The journey out becomes a trip: its return starts where it ends and comes home, ready for times. */
  const addReturn = () => {
    setEditing(null);
    setArranging(false);
    planDispatch({ type: 'addReturn' });
    listRef.current?.scrollTo({ top: 0 });
  };
  /** Another journey from where the trip last arrives: its destination is the one to choose. */
  const addSection = () => {
    const from = serializedJourneys.at(-1)?.stops.at(-1);
    flushSync(() => {
      planDispatch({ type: 'addSection' });
      setEditing(from ? 1 : 0);
    });
    focusTakeover();
    listRef.current?.scrollTo({ top: 0 });
  };
  /**
   * An empty compared journey offers alternatives to the first journey with a route, never a copy. In
   * compared trips, an empty way back offers the way out reversed, with its connections or nonstop.
   */
  const similar = useMemo((): { title: string; routes: SuggestedRoute[] } | null => {
    if (!(comparing || comparingTrips) || !index || filledAirports.length > 0) return null;
    const { sections, section } = shape;
    // The same journey of every alternative: the journeys to offer alternatives to and to avoid repeating.
    const peers = serializedJourneys.filter((_, i) => i % sections === section);
    if (comparingTrips && section > 0) {
      const out = serializedJourneys[plan.active - 1].stops.map((stop) => stop.airport);
      if (out.length < 2 || out[0].id === out.at(-1)!.id) return null;
      const back = [...out].reverse();
      const routes = [back, ...(back.length > 2 ? [[back[0], back.at(-1)!]] : [])].map((airports) => ({
        airports,
        minutes: estimateRoute(airports)?.minutes ?? 0,
      }));
      return { title: t('trips.wayBack'), routes };
    }
    const reference = peers.find((entry) => entry !== serializedJourneys[plan.active] && entry.stops.length >= 2);
    if (!reference) return null;
    const routes = similarRoutes(
      reference.stops.map((stop) => stop.airport),
      index,
      peers.map((entry) => entry.stops.map((stop) => stop.airport.id)),
    );
    return routes.length ? { title: t('compare.similar'), routes } : null;
  }, [comparing, comparingTrips, index, filledAirports.length, serializedJourneys, plan.active, shape, t]);
  const chooseSimilar = ({ airports }: SuggestedRoute) => {
    setEditing(null);
    const ids = airports.map((airport) => airport.id);
    dispatch({ type: 'load', airportIds: ids });
    // A trip's way out chosen this way comes back the same way, unless its return is already planned.
    const next = plan.active + 1;
    if (comparingTrips && shape.section === 0 && next % shape.sections !== 0)
      if (plan.journeys[next].route.stops.every((stop) => stop.airportId === null))
        planDispatch({ type: 'route', index: next, action: { type: 'load', airportIds: [...ids].reverse() } });
  };
  const routingStatus = {
    airspace: avoidAirspace ? { failed: routing.failed.airspace } : null,
    diversion: diversionRouting ? { failed: routing.failed.diversion } : null,
    reviewed: routing.airspaceReviewed,
  };
  /**
   * What Edit's name field names: a trip's journey, a compared trip as a whole (e.g. a traveller), a compared
   * journey or the journey. Names travel in links as `label`, `b.label`, … and `2.label`, ….
   */
  const nameTarget = (() => {
    const draft = (index: number) => ({ index, key: plan.journeys[index].key });
    if (tripMode) return { ...draft(plan.active), placeholder: names[plan.active], label: t('trip.nameLabel') };
    if (activeTrip) {
      const others = trips!.map((entry) => ({ ...entry, label: null }));
      return {
        ...draft(shape.option * shape.sections),
        placeholder: tripCaptions(others, { t, fmt })[shape.option],
        label: t('trips.nameLabel', activeTrip.id),
      };
    }
    const codes = filledAirports.map(airportCode).join(' → ');
    return comparing
      ? { ...draft(plan.active), placeholder: codes, label: t('compare.nameLabel', compared[plan.active].id) }
      : { ...draft(0), placeholder: codes || t('panel.yourJourney'), label: t('trip.nameLabel') };
  })();
  /** Opens a journey's flight in the editor, e.g. to fix times that keep it from playing. */
  const editJourneyLeg = (index: number, leg: number) => {
    activateJourney(index);
    planDispatch({ type: 'route', index, action: { type: 'selectLeg', leg } });
    setCollapsed(false);
  };
  // The launcher: what Play will show, as a miniature of the timeline it opens.
  const launcherShown = hasFlights && !timeBarShown;
  const launcherLanes = useMemo(
    () =>
      trip
        ? tripPreview(trip)
        : trips
          ? comparisonPreview(trips.map((entry) => ({ color: entry.color, trip: entry.trip })))
          : comparing
            ? comparisonPreview(compared.map((entry) => ({ color: entry.color, journey: entry.journey })))
            : journeyPreview(journey),
    [trip, trips, comparing, compared, journey],
  );
  const launcherLabel = trip
    ? t('trip.play')
    : trips
      ? t('launcher.compareTrips', fmt.number(trips.filter((entry) => entry.trip.totals.flights > 0).length))
      : comparing
        ? t('launcher.compare', fmt.number(compared.filter((entry) => entry.journey.legs.length > 0).length))
        : t('timebar.playJourney');
  /** The launcher's route (the board) and its length or dates: what Play will show. */
  const launcherText = (() => {
    const codes = (airports: readonly Airport[]) => airports.map(airportCode).join(' → ');
    if (trips || comparing) {
      // Alternatives between the same places show those places; otherwise how many there are.
      const ends = (trips ? trips.map((entry) => entry.trip.sections[0]?.journey) : compared.map((e) => e.journey))
        .filter((entry) => entry && entry.stops.length >= 2)
        .map((entry) => [entry!.stops[0].airport, entry!.stops.at(-1)!.airport]);
      const same = ends.length > 0 && ends.every(([a, b]) => a.id === ends[0][0].id && b.id === ends[0][1].id);
      const count = trips
        ? t('launcher.trips', fmt.number(trips.filter((entry) => entry.trip.totals.flights > 0).length))
        : t('launcher.journeys', fmt.number(compared.filter((entry) => entry.journey.legs.length > 0).length));
      return same ? { route: codes(ends[0]), detail: count } : { route: count, detail: '' };
    }
    if (trip) {
      const route = tripRouteCodes(trip.sections.map((s) => s.journey.stops.map((stop) => stop.airport)));
      const detail =
        trip.start && trip.end
          ? `${trip.dated ? '' : '≈ '}${fmt.dateRange(trip.start.local.slice(0, 10), trip.end.local.slice(0, 10))}`
          : t('summary.flights', fmt.number(trip.totals.flights));
      return { route, detail };
    }
    return {
      route: codes(filledAirports),
      detail: totalMin ? `${estimated ? '≈ ' : ''}${fmt.duration(totalMin)}` : '',
    };
  })();
  /** A schedule that cannot play: the launcher names the flight whose times to fix and opens it. */
  const launcherProblem = (() => {
    if (!scheduleErrors) return null;
    const index = flatJourneys.findIndex((entry) => entry.issues.some((issue) => issue.severity === 'error'));
    const issue = flatJourneys[index]?.issues.find((entry) => entry.severity === 'error');
    if (issue) {
      const leg = issue.leg ?? (issue.field === 'arrival' ? Math.max(0, (issue.stop ?? 1) - 1) : (issue.stop ?? 0));
      return {
        title: t('timebar.fixTimes', leg + 1),
        detail: t('timebar.checkTheLocalDatesAndTimes'),
        onFix: () => editJourneyLeg(index, leg),
      };
    }
    // Journeys of one trip that overlap: the later one departs before the earlier one lands.
    const overlaps = trip
      ? trip.issues.map((entry) => ({ flat: entry.section, name: names[entry.section] }))
      : (trips ?? []).flatMap((entry, option) =>
          entry.trip.issues.map((item) => ({
            flat: option * shape.sections + item.section,
            name: sectionTitles[option]?.[item.section] ?? '',
          })),
        );
    const overlap = overlaps[0];
    return overlap
      ? {
          title: t('trip.departsBefore', overlap.name),
          detail: t('timebar.checkTheLocalDatesAndTimes'),
          onFix: () => {
            activateJourney(overlap.flat);
            setCollapsed(false);
          },
        }
      : null;
  })();
  const launcher = (docked: boolean) => (
    <PlayLauncher
      label={launcherLabel}
      route={launcherText.route}
      detail={launcherText.detail}
      lanes={launcherLanes}
      problem={launcherProblem}
      docked={docked}
      shortcut={finePointer && isDesktop}
      cue={playCue}
      onPlay={togglePlayback}
      onExpand={docked && sheetCollapsed ? sheet.expand : undefined}
    />
  );
  const summary = trip ? (
    <TripSummary
      trip={trip}
      names={names}
      active={plan.active}
      unit={unit}
      timeOpen={timeOpen}
      playScope={scope}
      routing={routingStatus}
      onActivate={activateJourney}
      onPlayTrip={() => playTripScope(null)}
      onPlaySection={playTripScope}
      onStayChange={(index, minutes) => planDispatch({ type: 'setStay', index, minutes })}
      onCheck={(section, leg) => {
        activateJourney(section);
        if (leg !== null) planDispatch({ type: 'route', index: section, action: { type: 'selectLeg', leg } });
        setCollapsed(false);
      }}
    />
  ) : trips && tripMetrics ? (
    <TripCompareSummary
      list={trips}
      metrics={tripMetrics}
      captions={captions}
      columns={columns}
      active={shape.option}
      onActivate={activateTrip}
    />
  ) : comparing ? (
    <CompareSummary list={compared} metrics={metrics} active={plan.active} onActivate={activateJourney} />
  ) : (
    legs.length > 0 && (
      <Summary
        journey={journey}
        onCheckLeg={editLeg}
        legs={legs}
        layovers={layovers}
        unit={unit}
        routing={routingStatus}
        onDownloadPaths={hasTracks ? downloadPaths : undefined}
      />
    )
  );
  const canArrange = filledAirports.length > 0 || route.stops.length > 2;

  const canReset = kind !== 'single' || timeOpen || canArrange || hasEnteredTimes(route.stops);
  // A route that is exactly one of the suggestions keeps the list, so people can switch between them.
  const welcomeRoutes = useMemo(
    () => suggestions.map(({ from, to, minutes }): SuggestedRoute => ({ airports: [from, to], minutes })),
    [suggestions],
  );
  const chosenSuggestion = welcomeRoutes.find(
    ({ airports }) =>
      route.stops.length === 2 &&
      route.stops.every((stop, i) => stop.airportId === airports[i].id) &&
      !hasEnteredTimes(route.stops),
  );
  const showSuggestions =
    initialized && kind === 'single' && (filledAirports.length === 0 || chosenSuggestion !== undefined);
  const timeBar = (docked: boolean) => (
    <TimeBar
      clock={clock}
      journey={journey}
      timeline={timeline}
      comparison={comparing ? compared : undefined}
      trip={trip ? { trip, names, scope } : undefined}
      trips={
        trips && tripMetrics && tripsTimeline
          ? {
              list: trips,
              metrics: tripMetrics,
              timeline: tripsTimeline,
              names: sectionTitles,
              sections: shape.sections,
            }
          : undefined
      }
      active={trips ? shape.option : plan.active}
      onActivate={trips ? activateTrip : activateJourney}
      onEditJourneyLeg={(index, leg) => {
        activateJourney(index);
        planDispatch({ type: 'route', index, action: { type: 'selectLeg', leg } });
        setCollapsed(false);
      }}
      clockZone={clockZone}
      docked={docked}
      followAircraft={followAircraft}
      onFollowAircraft={globeFailed ? undefined : changeFollowAircraft}
      onClockZone={preferences.changeClockZone}
      onClose={closeTimeline}
      onToggle={togglePlayback}
      onLive={changeLive}
      onEditLeg={editLeg}
      compact={cinematic}
      cue={playCue}
      onShowControls={() => setControlsShown(true)}
      onHideControls={
        globeFailed
          ? undefined
          : () => {
              setControlsShown(false);
              if (!isDesktop && !collapsed) setCollapsed(true);
            }
      }
    />
  );

  const timeDial = (docked: boolean) => (
    <TimeDial
      clock={clock}
      clockZone={clockZone}
      reducedMotion={reducedMotion}
      docked={docked}
      onClockZone={preferences.changeClockZone}
      onSeek={exploreTime}
      onLive={changeLive}
    />
  );

  /**
   * Title, actions and journey tabs: pinned above the list on desktop; on phones they scroll with the list
   * at half height and stay pinned at full height, where editing happens.
   */
  const panelChrome = (
    <div className="panel__chrome">
      <JourneyPanelHeader
        name={kind === 'single' ? plan.journeys[0].label : null}
        comparing={comparing}
        trip={tripMode}
        comparingTrips={comparingTrips}
        hasAirports={filledAirports.length > 0}
        canArrange={canArrange}
        arranging={arranging}
        canReset={canReset}
        onToggleArranging={toggleArranging}
        onShare={share}
        onReset={resetJourney}
      />
      {kind !== 'single' && (
        <div className="panel__tabs">
          {comparing && (
            <JourneyTabs
              items={compared.map((entry) => {
                const airports = entry.journey.stops.map((stop) => airportCode(stop.airport));
                const label =
                  entry.label ??
                  (airports.length
                    ? (airports.length <= 3 ? airports : [airports[0], '…', airports.at(-1)]).join(' → ')
                    : t('compare.chooseAirports'));
                return {
                  id: entry.id,
                  chip: entry.id,
                  color: entry.color,
                  label,
                  prose: !label.includes('→'),
                };
              })}
              active={plan.active}
              label={t('compare.journeys')}
              onActivate={activateJourney}
              onAdd={compared.length < MAX_JOURNEYS ? addJourney : undefined}
              addLabel={t('compare.add')}
            />
          )}
          {trips && activeTrip && (
            <>
              <JourneyTabs
                items={trips.map((entry, i) => ({
                  id: entry.id,
                  chip: entry.id,
                  color: entry.color,
                  label: captions[i],
                  prose: !captions[i].includes('→'),
                }))}
                active={shape.option}
                label={t('trips.list')}
                onActivate={activateTrip}
                onAdd={trips.length < MAX_JOURNEYS ? addJourney : undefined}
                addLabel={t('trips.add')}
              />
              <SectionSwitch
                items={sectionTitles[shape.option].map((name, k) => {
                  const start = activeTrip.trip.sections[k].journey.start;
                  const date = start ? fmt.date(start.local.slice(0, 10), { year: false }) : '';
                  return {
                    name,
                    detail: date && `${activeTrip.trip.sections[k].anchor === 'entered' ? '' : '≈ '}${date}`,
                  };
                })}
                active={shape.section}
                color={activeTrip.color}
                label={t('trips.sections', activeTrip.id)}
                onActivate={activateSection}
              />
            </>
          )}
          {trip && (
            <JourneyTabs
              items={trip.sections.map((_, i) => ({
                id: String(i + 1),
                chip: String(i + 1),
                label: names[i],
                prose: false,
              }))}
              active={plan.active}
              label={t('trip.journeys')}
              onActivate={activateJourney}
              onAdd={trip.sections.length < MAX_SECTIONS ? addSection : undefined}
              addLabel={t('trip.addSection')}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`app ${isDesktop ? 'layout-desktop' : 'layout-mobile'}${cinematic ? ' is-cinematic' : ''}`}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files') && importContext) setFileOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files') || !importContext) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!event.relatedTarget || !(event.currentTarget as Node).contains(event.relatedTarget as Node))
          setFileOver(false);
      }}
      onDrop={(event) => {
        setFileOver(false);
        const file = event.dataTransfer.files[0];
        if (!file || !importContext) return;
        event.preventDefault();
        importRef.current?.open({ file });
      }}
    >
      <div className={`stage${globeReady ? ' is-ready' : ''}`}>
        {globeFailed ? (
          <div className="globe-fallback" role="note">
            <p className="globe-fallback__title">{t('errors.globeTitle')}</p>
            <p>{t('errors.noWebGL')}</p>
          </div>
        ) : (
          <ErrorBoundary onError={failGlobe}>
            <Suspense fallback={null}>
              <GlobeView
                sim={sim}
                followAircraft={followAircraft}
                onFollowAircraftChange={changeFollowAircraft}
                route={globeRoute}
                selectedLeg={route.selectedLeg === null ? null : legOffsets[plan.active] + route.selectedLeg}
                insets={insets}
                showBorders={showBorders}
                showCountryNames={showCountryNames}
                showWaterNames={showWaterNames}
                userLocation={location.position}
                locale={locale}
                reducedMotion={reducedMotion}
                fitNonce={fitNonce}
                moonNonce={moonNonce}
                onLegClick={(globalLeg) => {
                  const index = flatJourneys.findIndex(
                    (entry, i) => globalLeg >= legOffsets[i] && globalLeg < legOffsets[i] + entry.legs.length,
                  );
                  const target = index < 0 ? null : { index, leg: globalLeg - legOffsets[index] };
                  if (!target) return;
                  if (target.index === plan.active) selectLeg(route.selectedLeg === target.leg ? null : target.leg);
                  else {
                    activateJourney(target.index);
                    if (followAircraft) changeFollowAircraft(false);
                    planDispatch({
                      type: 'route',
                      index: target.index,
                      action: { type: 'selectLeg', leg: target.leg },
                    });
                    const departure = flatJourneys[target.index].legs[target.leg]?.departure;
                    if (timeOpen && departure) clock.seek(departure.epochMs);
                  }
                }}
                onFitChange={setFits}
                onReady={() => setGlobeReady(true)}
                onError={failGlobe}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      <header className="topbar" inert={cinematic}>
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
          hidden={cinematic}
          globe={!globeFailed}
          showWaterNames={showWaterNames}
          reducedMotion={reducedMotion}
          myLocation={myLocation}
          locationAvailable={locationAvailable}
          onToggleWaterNames={preferences.toggleWaterNames}
          onToggleReduceMotion={preferences.toggleReduceMotion}
          onToggleMyLocation={preferences.toggleMyLocation}
          showBorders={showBorders}
          showCountryNames={showCountryNames}
          dayNight={dayNight}
          unit={unit}
          avoidAirspace={avoidAirspace}
          onToggleAvoidAirspace={preferences.toggleAvoidAirspace}
          diversionRouting={diversionRouting}
          onToggleDiversionRouting={preferences.toggleDiversionRouting}
          frameLabel={
            legs.length
              ? route.selectedLeg !== null
                ? t('panel.reCentreOnThisFlight')
                : t('panel.reCentreOnTheRoute')
              : null
          }
          onToggleBorders={toggleBorders}
          onToggleCountryNames={toggleCountryNames}
          onToggleDayNight={preferences.toggleDayNight}
          onUnitChange={changeUnit}
          onFindMoon={dayNight && !globeFailed ? () => setMoonNonce((n) => n + 1) : undefined}
          onFit={() => setFitNonce((n) => n + 1)}
        />
      )}

      {((isDesktop && (!shortScreen || cinematic) && (timeBarShown || launcherShown)) ||
        (!globeFailed && !timeBarShown)) && (
        <div
          className="hud-wrap"
          style={
            {
              '--inset-left': `${insets.left}px`,
              '--inset-bottom': `${isDesktop ? insets.bottom : sheetInset}px`,
            } as React.CSSProperties
          }
        >
          {!globeFailed && !timeOpen && (
            <GlobeHud legs={legs} selectedLeg={route.selectedLeg} fits={fits} onSelectLeg={selectLeg} />
          )}
          {isDesktop && (!shortScreen || cinematic) && timeBarShown && timeBar(false)}
          {isDesktop && !shortScreen && launcherShown && launcher(false)}
          {isDesktop && dialShown && timeDial(false)}
        </div>
      )}

      <main
        ref={panelRef}
        className={`panel${plan.journeys.length >= 3 || tripMode || comparingTrips ? ' has-many-journeys' : ''}${sheetCollapsed ? ' is-collapsed' : ''}${!isDesktop && sheetFull && !sheetCollapsed ? ' is-full' : ''}${!isDesktop && timeBarShown ? ' has-timeline' : ''}`}
        aria-label={t('panel.journeyPlanner')}
        inert={isDesktop && cinematic}
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

        {/* Phones and short landscape screens: the player is the top of the panel, leaving the globe clear. */}
        {(!isDesktop || (shortScreen && !cinematic)) && timeBarShown && timeBar(true)}
        {(!isDesktop || shortScreen) && launcherShown && launcher(true)}
        {/* The dial belongs to the globe view; the open planner needs the room. */}
        {!isDesktop && dialShown && sheetCollapsed && timeDial(true)}

        {sheetCollapsed ? (
          !timeBarShown &&
          !launcherShown && (
            <CollapsedJourneyPeek
              airports={filledAirports}
              routeText={
                trip ? tripRouteCodes(trip.sections.map((s) => s.journey.stops.map((stop) => stop.airport))) : undefined
              }
              detail={
                trip && trip.totals.flights
                  ? `${fmt.distance(trip.totals.distanceKm, unit)} · ${
                      trip.start && trip.end
                        ? `${trip.dated ? '' : '≈ '}${fmt.dateRange(trip.start.local.slice(0, 10), trip.end.local.slice(0, 10))}`
                        : t('summary.flights', fmt.number(trip.totals.flights))
                    }`
                  : undefined
              }
              hasLegs={legs.length > 0}
              totalKm={totalKm}
              totalMin={totalMin}
              estimated={estimated}
              unit={unit}
              onExpand={sheet.expand}
            />
          )
        ) : (
          <>
            {isDesktop && panelChrome}
            <div ref={listRef} className="panel__scroll">
              {!isDesktop && panelChrome}
              <div
                role={kind !== 'single' ? 'tabpanel' : undefined}
                id={kind !== 'single' ? 'journey-panel' : undefined}
                aria-labelledby={
                  comparing
                    ? `journey-tab-${compared[plan.active].id}`
                    : tripMode
                      ? `journey-tab-${plan.active + 1}`
                      : activeTrip
                        ? `journey-tab-${activeTrip.id} section-tab-${shape.section}`
                        : undefined
                }
                className="panel__list"
              >
                {dataError ? (
                  <p className="panel__error" role="alert">
                    {t('errors.airportsUnavailable')}
                  </p>
                ) : (
                  <>
                    {arranging && (
                      <NameField
                        key={`name-${nameTarget.key}`}
                        value={plan.journeys[nameTarget.index].label}
                        placeholder={nameTarget.placeholder}
                        label={nameTarget.label}
                        onChange={(label) => planDispatch({ type: 'setLabel', index: nameTarget.index, label })}
                      />
                    )}
                    {activeTrip &&
                      (() => {
                        const stay = activeTrip.trip.stays.find((entry) => entry.section === shape.section);
                        return stay ? (
                          <StayLine
                            className="stay-before"
                            stay={stay}
                            onChange={(minutes) => planDispatch({ type: 'setStay', index: plan.active, minutes })}
                          />
                        ) : null;
                      })()}
                    <StopList
                      key={plan.journeys[plan.active].key}
                      journeyColor={comparing ? compared[plan.active].color : activeTrip?.color}
                      legOffset={tripMode ? legOffsets[plan.active] : undefined}
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
                      onSelectLeg={selectListLeg}
                      onReverse={reverse}
                    />
                    {similar && (
                      <RouteSuggestions title={similar.title} routes={similar.routes} codes onSelect={chooseSimilar} />
                    )}
                    {(kind !== 'single' || legs.length > 0) && (
                      <div className="itinerary__actions">
                        {comparing && compared.some((entry) => entry.journey.stops.length >= 2) && (
                          <button type="button" className="row row--action compare-entry" onClick={addReturn}>
                            <span aria-hidden="true" />
                            <span className="row__icon">
                              <IconReturn size={17} />
                            </span>
                            <span>{t('trips.addReturns')}</span>
                          </button>
                        )}
                        {tripMode && plan.journeys.length <= MAX_SECTIONS && (
                          <button type="button" className="row row--action compare-entry" onClick={addJourney}>
                            <span aria-hidden="true" />
                            <span className="row__icon">
                              <IconCompare size={17} />
                            </span>
                            <span>{t('trips.entry')}</span>
                          </button>
                        )}
                        {comparingTrips ? (
                          <>
                            {shape.section > 0 && (
                              <button
                                type="button"
                                className="row row--action compare-remove"
                                onClick={() => {
                                  setEditing(null);
                                  planDispatch({ type: 'removeSection', section: shape.section });
                                }}
                              >
                                <span aria-hidden="true" />
                                <span className="row__icon">
                                  <IconTrash size={16} />
                                </span>
                                <span>
                                  {shape.sections === 2
                                    ? t('trips.removeReturns')
                                    : t('trips.removeSection', columns[shape.section] ?? '')}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="row row--action compare-remove"
                              onClick={() => {
                                setEditing(null);
                                planDispatch({ type: 'removeOption', option: shape.option });
                              }}
                            >
                              <span aria-hidden="true" />
                              <span className="row__icon">
                                <IconTrash size={16} />
                              </span>
                              <span>{t('trips.remove')}</span>
                            </button>
                          </>
                        ) : comparing || tripMode ? (
                          <button
                            type="button"
                            className="row row--action compare-remove"
                            onClick={() => {
                              setEditing(null);
                              planDispatch({ type: 'remove', index: plan.active });
                            }}
                          >
                            <span aria-hidden="true" />
                            <span className="row__icon">
                              <IconTrash size={16} />
                            </span>
                            <span>{tripMode ? t('trip.remove') : t('compare.remove', compared[plan.active].id)}</span>
                          </button>
                        ) : (
                          <>
                            {filledAirports[0]?.id !== filledAirports.at(-1)?.id && (
                              <button type="button" className="row row--action compare-entry" onClick={addReturn}>
                                <span aria-hidden="true" />
                                <span className="row__icon">
                                  <IconReturn size={17} />
                                </span>
                                <span>{t('trip.addReturn')}</span>
                              </button>
                            )}
                            <button type="button" className="row row--action compare-entry" onClick={addJourney}>
                              <span aria-hidden="true" />
                              <span className="row__icon">
                                <IconCompare size={17} />
                              </span>
                              <span>{t('compare.entry')}</span>
                            </button>
                            {hasTracks && (
                              <button
                                type="button"
                                className="row row--action compare-entry"
                                onClick={compareWithGenerated}
                              >
                                <span aria-hidden="true" />
                                <span className="row__icon">
                                  <IconTrack size={17} />
                                </span>
                                <span>{t('track.compareGenerated')}</span>
                              </button>
                            )}
                          </>
                        )}
                        {arranging && hasTracks && (
                          <button type="button" className="row row--action compare-entry" onClick={useGeneratedPaths}>
                            <span aria-hidden="true" />
                            <span className="row__icon">
                              <IconTrack size={17} />
                            </span>
                            <span>{t('track.useGenerated')}</span>
                          </button>
                        )}
                        {!arranging && (kind === 'single' || canCompareImport) && (
                          <button
                            type="button"
                            className="row row--action compare-entry"
                            onClick={() => importRef.current?.open()}
                          >
                            <span aria-hidden="true" />
                            <span className="row__icon">
                              <IconImport size={17} />
                            </span>
                            <span>{t('import.entry')}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {showSuggestions && !dataError && (
                  <div className="entries">
                    <RouteImportEntry onOpen={() => importRef.current?.open()} />
                    <AiImportEntry onOpen={() => aiRef.current?.open()} />
                  </div>
                )}
                {showSuggestions && (
                  <RouteSuggestions
                    title={t('panel.orTryOneOfThese')}
                    routes={welcomeRoutes}
                    chosen={chosenSuggestion ?? null}
                    onSelect={chooseSuggestion}
                  />
                )}
              </div>
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
        {initialized
          ? trip
            ? t(
                'trip.announcement',
                fmt.number(trip.sections.length),
                tripRouteCodes(trip.sections.map((s) => s.journey.stops.map((stop) => stop.airport))),
              )
            : comparing
              ? comparisonAnnouncement
              : trips
                ? tripsAnnouncement
                : fmt.describeRoute(legs, layovers, unit)
          : ''}
      </p>
      <p className="sr-only" aria-live="polite">
        {activeState ? fmt.describeState(journey, activeState).title : ''}
      </p>
      {isDesktop && <VersionTag />}
      <Toast toast={toast} />
      <AboutDialog ref={aboutRef} meta={dataset?.meta ?? null} analytics={analytics} />
      <AiImportDialog ref={aiRef} />
      <RouteImportDialog
        ref={importRef}
        context={importContext}
        unit={unit}
        canCompare={canCompareImport}
        onImport={importFlights}
      />
      {fileOver && (
        <div className="drop-overlay" aria-hidden="true">
          <span className="drop-overlay__card">
            <IconImport size={28} />
            {t('import.dropHere')}
          </span>
        </div>
      )}
    </div>
  );
}
