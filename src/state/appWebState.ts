import type { ClockSnapshot } from './clock.ts';
import {
  parseLink,
  serializeLink,
  type LinkView,
  type SerializableLinkStop,
  type SerializableJourney,
} from './link.ts';
import type { Locale } from '../i18n/locales.ts';
import { localizedPath } from '../i18n/detect.ts';
import { linkStateToDocument } from '../agent/itinerary.ts';
import { planComparison, planItinerary, type AgentContext } from '../agent/plan.ts';
import { formatIsoInstant } from '../lib/timezone.ts';
import type { Journey } from '../lib/schedule.ts';

type LinkExtra = { label?: string | null; compare: SerializableJourney[] };

export function createToolView(
  snapshot: ClockSnapshot,
  timeOpen: boolean,
  view: Omit<LinkView, 'time' | 'play' | 'speed' | 'leg'>,
  selectedLeg: number | null,
): LinkView {
  return {
    time: timeOpen ? snapshot.time : null,
    play: snapshot.playing,
    speed: snapshot.speed,
    ...view,
    ...(selectedLeg !== null ? { leg: selectedLeg + 1 } : {}),
  };
}

export function createVisitShareLink(
  origin: string,
  base: string,
  locale: Locale,
  primaryStops: SerializableLinkStop[],
  view: LinkView,
  selectedLeg: number | null,
  extra: LinkExtra,
): string {
  const url = new URL(localizedPath(base, locale), origin);
  url.search = serializeLink(
    primaryStops,
    {
      ...view,
      lang: undefined,
      leg: selectedLeg !== null ? selectedLeg + 1 : undefined,
    },
    true,
    extra,
  );
  // An explicit empty route must not reload the remembered journey.
  if (!primaryStops.length) url.searchParams.set('route', '');
  return url.href;
}

interface ToolJourneyOptions {
  context: AgentContext;
  primaryStops: SerializableLinkStop[];
  linkExtra: LinkExtra;
  serializedJourneys: SerializableJourney[];
  active: number;
  currentView: LinkView;
  snapshot: ClockSnapshot;
  assumedStart: number | null;
  journey: Journey;
  url: string;
}

export function toolJourneyResponse({
  context,
  primaryStops,
  linkExtra,
  serializedJourneys,
  active,
  currentView,
  snapshot,
  assumedStart,
  journey,
  url,
}: ToolJourneyOptions) {
  const doc = linkStateToDocument(
    parseLink(serializeLink(primaryStops, { ...currentView, leg: undefined }, false, linkExtra)),
  );
  const assumption =
    currentView.time !== null ? { assumeDeparture: formatIsoInstant(assumedStart ?? snapshot.time) } : {};
  const comparisonPlan = serializedJourneys.length > 1 ? planComparison(context, doc, assumption) : null;
  const activeDoc = { version: 1 as const, stops: doc.journeys?.[active]?.stops ?? doc.stops ?? [] };
  const plan = planItinerary(
    context,
    activeDoc,
    !journey.dated && journey.start ? { assumeDeparture: formatIsoInstant(journey.start.epochMs) } : {},
  );
  return {
    ...(comparisonPlan
      ? {
          comparison: {
            journeys: comparisonPlan.journeys,
            comparison: comparisonPlan.comparison,
            url,
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
    url,
  };
}
