import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { AboutDialog, type AboutDialogHandle } from './components/AboutDialog.tsx';
import { AiImportDialog, AiImportEntry, type AiImportDialogHandle } from './components/AiImportDialog.tsx';
import { AirportPicker, type AirportPickerHandle } from './components/AirportPicker.tsx';
import { Brand, VersionTag } from './components/Brand.tsx';
import { CollapsedJourneyPeek } from './components/CollapsedJourneyPeek.tsx';
import { CompareSummary } from './components/CompareSummary.tsx';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlobeHud } from './components/GlobeHud.tsx';
import { IconInfo, IconPlay, IconCompare, IconReturn, IconTrash } from './components/Icons.tsx';
import { JourneyPanelHeader } from './components/JourneyPanelHeader.tsx';
import { JourneyTabs } from './components/JourneyTabs.tsx';
import { MapTools } from './components/MapTools.tsx';
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
import { useJourneyAddress } from './hooks/useJourneyAddress.ts';
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
import { estimateRoute, similarRoutes } from './data/similarRoutes.ts';
import { comparisonGlobeRoute } from './lib/compareView.ts';
import { tripComparisonGlobeRoute, tripGlobeRoute, tripRouteCodes } from './lib/tripView.ts';
import { tripComparisonSkips } from './lib/compareTrips.ts';
import { MAX_SECTIONS, stayPlaybackSkips, tripStateAt } from './lib/trip.ts';
import { MAX_JOURNEYS } from './lib/compare.ts';
import type { LegRouter } from './lib/compare.ts';
import { sumDurations } from './lib/flightTime.ts';
import { journeyStateAt } from './lib/timeline.ts';
import { createPlanState, planKind, planReducer, planShape } from './state/plan.ts';
import { playInRange } from './state/playbackRange.ts';
import { hasEnteredTimes, type RouteAction } from './state/route.ts';
import { createSimulationFeed, type SimulationContext } from './state/simulation.ts';
import type { Airport, LocalTimeInput } from './types.ts';

const GlobeView = lazy(() => import('./globe/GlobeView.tsx'));

export default function App() {
  const { t, fmt, locale, setVisitLocale } = useI18n();

  // Side panel on wide screens and landscape tablets; bottom sheet on phones and portrait tablets.
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
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
  const [collapsed, setCollapsed] = useState(() => startsEmpty && !window.matchMedia(DESKTOP_MEDIA_QUERY).matches);
  const [fits, setFits] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [moonNonce, setMoonNonce] = useState(0);
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

  const shareUrl = useJourneyAddress({
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

  useAppWebTools({
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
    dial: dialShown,
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
      showToast(t('toasts.linkCopied'));
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
  const editLeg = (leg: number) => {
    selectLeg(leg);
    setCollapsed(false);
  };
  const togglePlayback = () => {
    if (!timeOpen || !clock.getSnapshot().playing) trackEvent('play_journey', { flights: legs.length });
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
  /** Plays a trip whole (null) or one of its journeys from its start, whatever is playing now. */
  const playTripScope = (next: number | null) => {
    if (!trip) return;
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
    setArranging((on) => !on);
  };

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
  const fastestJourney = compared.find((entry) => entry.id === metrics.fastest);
  const fastestTrip = tripMetrics?.trips.find((entry) => entry.id === tripMetrics.fastest);
  const tripsAnnouncement = trips
    ? fastestTrip
      ? t(
          'trips.announcement',
          fmt.number(trips.length),
          trips.find((entry) => entry.id === fastestTrip.id)?.label ?? fastestTrip.id,
          fmt.duration(fastestTrip.travelMin),
        )
      : t('trips.comparing', fmt.number(trips.length))
    : '';
  const comparisonAnnouncement = fastestJourney
    ? t(
        'compare.announcement',
        compared.length,
        fastestJourney.label ?? fastestJourney.id,
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
    peek: timeBarShown ? 'timeline' : dialShown ? 'dial' : 'route',
  });
  // On phones, a docked timeline or an open flight-times editor needs the sheet's room more than the
  // totals do, so the totals scroll with the list instead of staying pinned beneath it.
  const summaryInList = !isDesktop && (timeOpen || route.selectedLeg !== null);
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
      onPlay={togglePlayback}
      timeOpen={timeOpen}
    />
  ) : comparing ? (
    <CompareSummary
      list={compared}
      metrics={metrics}
      active={plan.active}
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
        routing={routingStatus}
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

  return (
    <div className={`app ${isDesktop ? 'layout-desktop' : 'layout-mobile'}`}>
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

      {((isDesktop && timeBarShown) || (!globeFailed && !timeBarShown)) && (
        <div
          className="hud-wrap"
          style={
            {
              '--inset-left': `${insets.left}px`,
              '--inset-bottom': `${isDesktop ? insets.bottom : sheetInset}px`,
            } as React.CSSProperties
          }
        >
          {isDesktop && timeBarShown && timeBar(false)}
          {isDesktop && dialShown && timeDial(false)}
          {!globeFailed && !timeOpen && (
            <GlobeHud legs={legs} selectedLeg={route.selectedLeg} fits={fits} onSelectLeg={selectLeg} />
          )}
        </div>
      )}

      <main
        ref={panelRef}
        className={`panel${plan.journeys.length >= 3 || tripMode || comparingTrips ? ' has-many-journeys' : ''}${sheetCollapsed ? ' is-collapsed' : ''}${!isDesktop && timeBarShown ? ' has-timeline' : ''}`}
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

        {!isDesktop && timeBarShown && timeBar(true)}
        {/* The dial belongs to the globe view; the open planner needs the room. */}
        {!isDesktop && dialShown && sheetCollapsed && timeDial(true)}

        {sheetCollapsed ? (
          !timeBarShown && (
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

            {comparing && (
              <JourneyTabs
                items={compared.map((entry) => {
                  const airports = entry.journey.stops.map((stop) => airportCode(stop.airport));
                  return {
                    id: entry.id,
                    chip: entry.id,
                    color: entry.color,
                    label:
                      entry.label ??
                      (airports.length
                        ? (airports.length <= 3 ? airports : [airports[0], '…', airports.at(-1)]).join(' → ')
                        : t('compare.chooseAirports')),
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
                items={trip.sections.map((_, i) => ({ id: String(i + 1), chip: String(i + 1), label: names[i] }))}
                active={plan.active}
                label={t('trip.journeys')}
                onActivate={activateJourney}
                onAdd={trip.sections.length < MAX_SECTIONS ? addSection : undefined}
                addLabel={t('trip.addSection')}
              />
            )}
            <div
              ref={listRef}
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
              className="panel__scroll"
            >
              {dataError ? (
                <p className="panel__error" role="alert">
                  {t('errors.airportsUnavailable')}
                </p>
              ) : (
                <>
                  {arranging && (
                    <NameField
                      key={nameTarget.key}
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
                    onSelectLeg={selectLeg}
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
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {showSuggestions && !dataError && <AiImportEntry onOpen={() => aiRef.current?.open()} />}
              {showSuggestions && (
                <RouteSuggestions
                  title={t('panel.orTryOneOfThese')}
                  routes={welcomeRoutes}
                  chosen={chosenSuggestion ?? null}
                  onSelect={chooseSuggestion}
                />
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
    </div>
  );
}
