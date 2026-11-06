import { createToolView, createVisitShareLink, toolJourneyResponse } from '../state/appWebState.ts';
import type { useJourneyModel } from './useJourneyModel.ts';
import type { useJourneyPlayback } from './useJourneyPlayback.ts';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { useWebTools } from './useWebTools.ts';
import { parseWebCommand } from '../agent/webTools.ts';
import { createAgentContext, planItinerary, planComparison } from '../agent/plan.ts';
import { linkStateToDocument } from '../agent/itinerary.ts';
import { replaceUrl } from '../analytics.ts';
import { visitLocaleAddress } from '../state/visitLocale.ts';
import { airportCode, type AirportDataset } from '../data/airports.ts';
import type { TimeZoneTable } from '../data/timezones.ts';
import type { SearchIndex } from '../data/search.ts';
import type { LinkState } from '../state/link.ts';
import type { CompareState, CompareAction } from '../state/compare.ts';
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
  comparison: CompareState;
  model: ReturnType<typeof useJourneyModel>;
  playback: ReturnType<typeof useJourneyPlayback>;
  setEditing: Setter<number | null>;
  dispatch: Dispatch<RouteAction>;
  compareDispatch: Dispatch<CompareAction>;
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
    comparison,
    model,
    playback,
    setEditing,
    dispatch,
    compareDispatch,
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
  const { compared, journey, serializedJourneys, primaryStops, linkExtra, playbackRange } = model;
  const { clockZone, unit, dayNight, followAircraft, showCountryNames, showBorders } = preferences;
  const route = comparison.journeys[comparison.active].route;
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
      route.selectedLeg,
    );
    const currentLink = () =>
      createVisitShareLink(
        window.location.origin,
        import.meta.env.BASE_URL,
        locale,
        primaryStops,
        currentView,
        comparison.journeys[0].route.selectedLeg,
        linkExtra,
      );
    if (command.type === 'get_share_link') return { url: currentLink() };
    if (command.type === 'get_journey') {
      return toolJourneyResponse({
        context,
        primaryStops,
        linkExtra,
        serializedJourneys,
        active: comparison.active,
        currentView,
        snapshot,
        assumedStart,
        journey,
        url: currentLink(),
      });
    }
    if (command.type === 'select_flight') {
      flushSync(() => {
        preferences.setVisit({ followAircraft: false });
        dispatch({ type: 'selectLeg', leg: command.leg === null ? null : command.leg - 1 });
      });
      return { applied: true, leg: command.leg };
    }
    if (command.type === 'set_route') {
      const plan = command.link.stops?.length
        ? (command.link.compare?.length ? planComparison : planItinerary)(context, linkStateToDocument(command.link))
        : null;
      if (plan && !plan.valid)
        throw new TypeError(
          plan.issues
            .filter((i) => i.severity === 'error')
            .map((i) => `${i.path ?? i.code}: ${i.message}`)
            .join(' '),
        );
      if (command.link.view.lang)
        replaceUrl(visitLocaleAddress(window.location.href, import.meta.env.BASE_URL, command.link.view.lang));
      flushSync(() => applyLink(command.link, index, command.search));
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
      preferences.patchView(patch);
      if (patch.speed !== undefined) clock.setSpeed(patch.speed);
      if (patch.leg !== undefined) {
        if (patch.follow === undefined) preferences.setVisit({ followAircraft: false });
        compareDispatch({ type: 'activate', index: 0 });
        compareDispatch({ type: 'route', index: 0, action: { type: 'selectLeg', leg: patch.leg - 1 } });
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
