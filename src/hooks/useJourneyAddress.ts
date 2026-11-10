import { useEffect, useMemo } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { localizedPath } from '../i18n/detect.ts';
import { airportCode } from '../data/airports.ts';
import { serializeLink, serializeLinkWithReduction, type LinkView } from '../state/link.ts';
import { saveLastJourney } from '../state/storage.ts';
import { replaceUrl } from '../analytics.ts';
import { planShape, type PlanState } from '../state/plan.ts';
import { tripRouteCodes } from '../lib/tripView.ts';
import type { useJourneyModel } from './useJourneyModel.ts';
import type { useViewPreferences } from './useViewPreferences.ts';

export interface JourneyAddressOptions {
  model: ReturnType<typeof useJourneyModel>;
  preferences: ReturnType<typeof useViewPreferences>;
  plan: PlanState;
  timeOpen: boolean;
  playing: boolean;
  live: boolean;
  pausedTime: number | null;
  speed: LinkView['speed'];
  initialized: boolean;
  updatePickerAddress: (address: string) => void;
}

/**
 * Address/share state for track-aware UI: returns `{ shareUrl, shareReduction: { kept, total } | null }`.
 * Fitting changes only the shared copy. The original useJourneyAddress(options) still returns a string.
 */
export function useJourneyAddressWithReduction({
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
}: JourneyAddressOptions) {
  const { t } = useI18n();
  const { primaryStops, filledStops, linkExtra, serializedJourneys, kind, legOffsets } = model;
  const {
    clockZone,
    linkUnits,
    dayNight,
    followAircraft,
    linkLayers,
    showCountryNames,
    showBorders,
    explicitDefaults,
  } = preferences;
  const comparing = kind === 'compare';
  const { sections } = planShape(plan);
  // Link flight numbers name the first journey's flights, or a trip's (trip A's) flights across its journeys.
  const counted = kind === 'trip' || (kind === 'compareTrips' && plan.active < sections);
  const selected = plan.journeys[counted ? plan.active : 0].route.selectedLeg;
  const leg = selected === null ? undefined : (counted ? legOffsets[plan.active] : 0) + selected + 1;
  const { query, shareReduction } = useMemo(
    () =>
      serializeLinkWithReduction(
        primaryStops,
        {
          time: timeOpen && !playing && !live ? pausedTime : null,
          live: timeOpen && live,
          speed,
          clock: clockZone,
          units: linkUnits,
          dayNight,
          follow: followAircraft,
          names: linkLayers.names !== undefined ? showCountryNames : undefined,
          borders: linkLayers.borders !== undefined ? showBorders : undefined,
          airspace: linkLayers.airspace !== undefined ? preferences.avoidAirspace : undefined,
          diversion: linkLayers.diversion !== undefined ? preferences.diversionRouting : undefined,
          leg,
        },
        explicitDefaults,
        linkExtra,
      ),
    [
      primaryStops,
      linkExtra,
      leg,
      timeOpen,
      playing,
      live,
      pausedTime,
      speed,
      clockZone,
      linkUnits,
      dayNight,
      followAircraft,
      linkLayers,
      showCountryNames,
      showBorders,
      preferences.avoidAirspace,
      preferences.diversionRouting,
      explicitDefaults,
    ],
  );
  const shareUrl = window.location.origin + localizedPath(import.meta.env.BASE_URL, null) + query;
  const addressUrl = window.location.origin + window.location.pathname + query;
  useEffect(() => {
    updatePickerAddress(addressUrl);
    if (!initialized) return;
    if (addressUrl !== window.location.href) replaceUrl(addressUrl);
    saveLastJourney(serializeLink(primaryStops, { speed }, false, linkExtra));
    const tripCodes = (list: typeof serializedJourneys) =>
      tripRouteCodes(list.map((entry) => entry.stops.map((s) => s.airport)));
    document.title =
      kind === 'trip'
        ? t('panel.routeTitle', tripCodes(serializedJourneys))
        : kind === 'compareTrips'
          ? t(
              'compare.documentTitle',
              Array.from({ length: serializedJourneys.length / sections }, (_, o) =>
                tripCodes(serializedJourneys.slice(o * sections, (o + 1) * sections)),
              )
                .filter(Boolean)
                .join(', '),
            )
          : comparing
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
    updatePickerAddress,
    filledStops,
    primaryStops,
    linkExtra,
    comparing,
    kind,
    sections,
    serializedJourneys,
    initialized,
    speed,
    t,
  ]);

  return { shareUrl, shareReduction };
}

/** Backwards-compatible string API used by App; import the companion hook to show reduction details. */
export function useJourneyAddress(options: JourneyAddressOptions): string {
  return useJourneyAddressWithReduction(options).shareUrl;
}
