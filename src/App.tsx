import { useJourneyAddress } from './hooks/useJourneyAddress.ts';
import { useJourneyModel } from './hooks/useJourneyModel.ts';
import { useJourneyPlayback, usePlaybackRange } from './hooks/useJourneyPlayback.ts';
import { playInRange } from './state/playbackRange.ts';
import { JourneyPanelHeader } from './components/JourneyPanelHeader.tsx';
import { CollapsedJourneyPeek } from './components/CollapsedJourneyPeek.tsx';
import { WelcomeSuggestions } from './components/WelcomeSuggestions.tsx';
import { usePanelInsets } from './hooks/usePanelInsets.ts';
import { usePickerHistory } from './hooks/usePickerHistory.ts';
import { DESKTOP_MEDIA_QUERY } from './hooks/appMedia.ts';
import { useAppLinks } from './hooks/useAppLinks.ts';
import { useAppWebTools } from './hooks/useAppWebTools.ts';
import { useI18n } from './i18n/I18nProvider.tsx';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AboutDialog, type AboutDialogHandle } from './components/AboutDialog.tsx';
import { AirportPicker, type AirportPickerHandle } from './components/AirportPicker.tsx';
import { Brand, VersionTag } from './components/Brand.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlobeHud } from './components/GlobeHud.tsx';
import { IconInfo, IconPlay, IconCompare, IconTrash } from './components/Icons.tsx';
import { MapTools } from './components/MapTools.tsx';
import { StopList } from './components/StopList.tsx';
import { Summary } from './components/Summary.tsx';
import { TimeBar } from './components/TimeBar.tsx';
import { Toast } from './components/Toast.tsx';
import { useGeolocation } from './hooks/useGeolocation.ts';
import { useToast } from './hooks/useToast.ts';
import { useBottomSheet } from './hooks/useBottomSheet.ts';

import { comparisonGlobeRoute, localLegAt } from './lib/compareView.ts';
import { compareReducer, createCompareState } from './state/compare.ts';
import { CompareSummary } from './components/CompareSummary.tsx';
import { JourneyTabs } from './components/JourneyTabs.tsx';
import { journeyStateAt } from './lib/timeline.ts';

import { createSimulationFeed, type SimulationContext } from './state/simulation.ts';
import { useClockPhase } from './hooks/useClock.ts';
import { airportCode } from './data/airports.ts';
import type { GlobeRoute } from './globe/GlobeRenderer.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent.ts';
import { trackEvent } from './analytics.ts';
import { ConsentNotice } from './components/ConsentNotice.tsx';
import { useVisualViewportVars } from './hooks/useVisualViewport.ts';
import { sumDurations } from './lib/flightTime.ts';

import { hasEnteredTimes, type RouteAction } from './state/route.ts';
import { useViewPreferences } from './hooks/useViewPreferences.ts';
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

  const [comparison, compareDispatch] = useReducer(compareReducer, undefined, createCompareState);
  const route = comparison.journeys[comparison.active].route;
  const comparing = comparison.journeys.length > 1;
  const dispatch = useCallback((action: RouteAction) => compareDispatch({ type: 'route', action }), []);
  // Only a newly added, unedited draft gets the copied-airports hint.
  const [copiedDraft, setCopiedDraft] = useState<{ index: number; airportIds: (number | null)[] } | null>(null);
  const [isExample, setIsExample] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  /** Edit mode: reorder, remove and insert stops, reverse or clear the route. */
  const [arranging, setArranging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fits, setFits] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
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
  const takeoverRef = useRef<AirportPickerHandle>(null);
  const aboutRef = useRef<AboutDialogHandle>(null);
  const analytics = useAnalyticsConsent();
  const playback = useJourneyPlayback(reducedMotion, setCollapsed);
  const { clock, timeOpen, assumedStart, linkedTime, pausedTime, speed, applyView, openTime, closeTime } = playback;
  const { dataset, zones, zonesLoaded, index, suggestions, dataError, initialized, lookup, loadCodes, applyLink } =
    useAppLinks({
      route,
      dispatch,
      compareDispatch,
      setCopiedDraft,
      setEditing,
      setIsExample,
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

  const model = useJourneyModel(comparison, { dataset, zones, lookup }, timeOpen, assumedStart);
  const {
    legs,
    layovers,
    filledAirports,
    compared,
    metrics,
    journey,
    timeline,
    playbackRange,
    scheduleErrors,
    legOffsets,
    fleet,
  } = model;
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
  usePlaybackRange(playback, playbackRange, zonesLoaded, scheduleErrors);

  const shareUrl = useJourneyAddress({
    model,
    preferences,
    comparison,
    timeOpen,
    playing,
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
    comparison,
    model,
    playback,
    setEditing,
    dispatch,
    compareDispatch,
    applyLink,
    locale,
    setVisitLocale,
  });

  const globeRoute = useMemo<GlobeRoute>(
    () => comparisonGlobeRoute(compared, comparison.active, timeOpen, fmt.city),
    [compared, comparison.active, timeOpen, fmt],
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
  });

  useEffect(() => {
    if (!refitAfterLayout.current) return;
    refitAfterLayout.current = false;
    setFitNonce((n) => n + 1);
  }, [insets]);

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
        time: playbackRange?.start ?? null,
        play: true,
        speed,
        clock: clockZone,
        units: linkUnits,
        dayNight,
        follow: followAircraft,
      });
    } else if (playbackRange && !scheduleErrors) {
      if (clock.getSnapshot().playing) clock.pause();
      else playInRange(clock, playbackRange, linkedTime);
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
      onClockZone={preferences.changeClockZone}
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
          onToggleWaterNames={preferences.toggleWaterNames}
          onToggleReduceMotion={preferences.toggleReduceMotion}
          onToggleMyLocation={preferences.toggleMyLocation}
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
          onToggleDayNight={preferences.toggleDayNight}
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
            <CollapsedJourneyPeek
              airports={filledAirports}
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
              comparing={comparing}
              isExample={isExample}
              hasAirports={filledAirports.length > 0}
              canArrange={canArrange}
              arranging={arranging}
              onToggleArranging={toggleArranging}
              onShare={share}
            />

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
                <WelcomeSuggestions
                  suggestions={suggestions}
                  isExample={isExample}
                  filledAirports={filledAirports}
                  onSelect={(from, to) =>
                    index && loadCodes([airportCode(from), airportCode(to)], index, { example: true })
                  }
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
