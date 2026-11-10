import { createToolView, createVisitShareLink, toolJourneyResponse } from '../state/appWebState.ts';
import type { useJourneyModel } from './useJourneyModel.ts';
import type { useJourneyPlayback } from './useJourneyPlayback.ts';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { useWebTools } from './useWebTools.ts';
import { parseWebCommand } from '../agent/webTools.ts';
import { createAgentContext, planItinerary, planComparison, planTrip } from '../agent/plan.ts';
import { linkStateToDocument } from '../agent/itinerary.ts';
import { isNamedClock } from '../agent/contract.ts';
import { replaceUrl } from '../analytics.ts';
import { visitLocaleAddress } from '../state/visitLocale.ts';
import { airportCode, type AirportDataset } from '../data/airports.ts';
import type { TimeZoneTable } from '../data/timezones.ts';
import type { SearchIndex } from '../data/search.ts';
import type { LinkState } from '../state/link.ts';
import { planShape, type PlanState, type PlanAction } from '../state/plan.ts';
import { sectionOfFlight } from '../lib/trip.ts';
import type { RouteAction } from '../state/route.ts';
import type { useI18n } from '../i18n/I18nProvider.tsx';
import type { useViewPreferences } from './useViewPreferences.ts';

type Setter<T> = Dispatch<SetStateAction<T>>;
interface AppWebToolsOptions {
  dataset: AirportDataset | null;
  zones: TimeZoneTable | null;
  index: SearchIndex | null;
  initialized: boolean;
  zonesLoaded: boolean;
  preferences: ReturnType<typeof useViewPreferences>;
  plan: PlanState;
  model: ReturnType<typeof useJourneyModel>;
  playback: ReturnType<typeof useJourneyPlayback>;
  setEditing: Setter<number | null>;
  dispatch: Dispatch<RouteAction>;
  planDispatch: Dispatch<PlanAction>;
  applyLink: (link: LinkState, index: SearchIndex, search: string) => void;
  locale: ReturnType<typeof useI18n>['locale'];
  setVisitLocale: ReturnType<typeof useI18n>['setVisitLocale'];
}

export function useAppWebTools(options: AppWebToolsOptions) {
  const {
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
  } = options;
  const {
    clock,
    timeOpen,
    assumedStart,
    pendingViewRef,
    pendingExplicitPlayRef,
    setAssumedStart,
    setTimeOpen,
    setLinkedTime,
    setPausedTime,
  } = playback;
  const { compared, trip, trips, journey, primaryStops, linkExtra, playbackRange, legOffsets, serializedJourneys } =
    model;
  const shape = planShape(plan);
  const { clockZone, unit, dayNight, followAircraft, showCountryNames, showBorders } = preferences;
  const route = plan.journeys[plan.active].route;
  const allJourneys = trip
    ? trip.sections.map((section) => section.journey)
    : trips
      ? trips.flatMap((entry) => entry.trip.sections.map((section) => section.journey))
      : compared.map((entry) => entry.journey);
  /** The trip whose flights links number across its journeys: the trip, or trip A of compared trips. */
  const countedTrip = trip ?? trips?.[0]?.trip ?? null;
  /** Selects a one-based flight: of the trip (across its journeys), else of the first journey. */
  const flightTarget = (leg: number) => {
    if (!countedTrip) return { index: 0, leg: leg - 1 };
    const located = sectionOfFlight(countedTrip, leg - 1);
    return located ? { index: located.section, leg: located.leg } : null;
  };
  /** The selected flight as links number it, when the journey being edited is one they count. */
  const countedLeg =
    route.selectedLeg === null || (trips && plan.active >= shape.sections)
      ? null
      : (countedTrip ? legOffsets[plan.active] : 0) + route.selectedLeg;
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
      countedTrip
        ? countedTrip.totals.flights
        : name === 'set_view'
          ? compared[0].journey.legs.length
          : journey.legs.length,
    );
    const context = getAgentContext();
    if (!context || !index) throw new Error('GlobeHops tools are not ready.');
    const snapshot = clock.getSnapshot();
    const currentView = createToolView(
      snapshot,
      timeOpen,
      {
        clock: clockZone,
        units: unit,
        dayNight,
        follow: followAircraft,
        names: showCountryNames,
        borders: showBorders,
        lang: locale,
      },
      countedLeg,
    );
    const currentLink = () =>
      createVisitShareLink(
        window.location.origin,
        import.meta.env.BASE_URL,
        locale,
        primaryStops,
        currentView,
        countedTrip ? countedLeg : plan.journeys[0].route.selectedLeg,
        linkExtra,
      );
    if (command.type === 'get_share_link') return { url: currentLink() };
    if (command.type === 'get_journey') {
      return toolJourneyResponse({
        context,
        primaryStops,
        linkExtra,
        active: trips ? shape.option : plan.active,
        activeSection: trips ? shape.section : undefined,
        currentView,
        snapshot,
        assumedStart,
        journey,
        url: currentLink(),
      });
    }
    if (command.type === 'select_flight') {
      const target = command.leg === null ? null : flightTarget(command.leg);
      flushSync(() => {
        preferences.setVisit({ followAircraft: false });
        if (!target) dispatch({ type: 'selectLeg', leg: null });
        else {
          if (countedTrip) planDispatch({ type: 'activate', index: target.index });
          planDispatch({
            type: 'route',
            index: countedTrip ? target.index : plan.active,
            action: { type: 'selectLeg', leg: target.leg },
          });
        }
      });
      return { applied: true, leg: command.leg };
    }
    if (command.type === 'set_route') {
      const doc = linkStateToDocument(command.link);
      const checked = command.link.stops?.length
        ? command.link.compare?.length
          ? planComparison(context, doc)
          : command.link.sections?.length
            ? planTrip(context, doc)
            : planItinerary(context, doc)
        : null;
      if (checked && !checked.valid)
        throw new TypeError(
          checked.issues
            .filter((i) => i.severity === 'error')
            .map((i) => `${i.path ?? i.code}: ${i.message}`)
            .join(' '),
        );
      if (command.link.view.lang)
        replaceUrl(visitLocaleAddress(window.location.href, import.meta.env.BASE_URL, command.link.view.lang));
      flushSync(() => applyLink(command.link, index, command.search));
      if (command.link.view.lang) await setVisitLocale(command.link.view.lang);
      return { applied: true, issues: checked?.issues ?? [] };
    }
    if (
      command.view.clock &&
      !isNamedClock(command.view.clock) &&
      !serializedJourneys.some((entry) => entry.stops.some((s) => airportCode(s.airport) === command.view.clock))
    )
      throw new TypeError('clock must name an airport in this route, local or utc.');
    if (
      command.view.play &&
      (!allJourneys.some((entry) => entry.legs.length) ||
        allJourneys.some((entry) => entry.issues.some((issue) => issue.severity === 'error')) ||
        (trip?.issues.length ?? 0) > 0 ||
        !!trips?.some((entry) => entry.trip.issues.length > 0))
    )
      throw new TypeError('Playback requires at least one flight and a valid schedule.');
    const patch = command.view;
    flushSync(() => {
      preferences.patchView(patch);
      if (patch.speed !== undefined) clock.setSpeed(patch.speed);
      const target = patch.leg !== undefined ? flightTarget(patch.leg) : null;
      if (target) {
        if (patch.follow === undefined) preferences.setVisit({ followAircraft: false });
        planDispatch({ type: 'activate', index: target.index });
        planDispatch({ type: 'route', index: target.index, action: { type: 'selectLeg', leg: target.leg } });
        setEditing(null);
      }
      if (patch.time !== undefined || patch.play !== undefined) {
        if (!timeOpen) {
          setAssumedStart(patch.time ?? Date.now());
          setTimeOpen(true);
        }
        if (patch.time !== undefined) {
          setLinkedTime(patch.time);
          setPausedTime(patch.time);
        }
        pendingViewRef.current = { ...currentView, ...patch };
        pendingExplicitPlayRef.current = patch.play === true;
        if (patch.play === false) clock.pause();
        // A view patch can leave the timeline unchanged, so apply it directly when already open.
        if (timeOpen) {
          pendingViewRef.current = null;
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
      replaceUrl(visitLocaleAddress(window.location.href, import.meta.env.BASE_URL, patch.lang));
      await setVisitLocale(patch.lang);
    }
    return { applied: true };
  });
}
