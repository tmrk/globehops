import type { DistanceUnit, LegRoute } from '../types.ts';
import type { useI18n } from '../i18n/I18nProvider.tsx';

type I18n = ReturnType<typeof useI18n>;

/** Countries by their localised name; the two marine zones by catalogue name. */
export function airspacePlaces(places: string[], { t, fmt }: Pick<I18n, 't' | 'fmt'>): string {
  return fmt.list(
    places.map((place) =>
      place === 'persian-gulf'
        ? t('airspace.persianGulf')
        : place === 'gulf-of-oman'
          ? t('airspace.gulfOfOman')
          : /^[A-Z]{2}$/.test(place)
            ? fmt.region(place)
            : place,
    ),
  );
}

export const airspaceWarning = (route: LegRoute | undefined) =>
  route?.status === 'partial' || route?.status === 'unavoided';

/** “+2,840 km” must not break before its unit. */
export const keepTogether = (text: string) => text.replace(/ /g, '\u00a0');

/** Extra distance flown to stay out of restricted airspace (not counting any diversion-cover share). */
export const detourKm = (route: LegRoute | undefined) =>
  route?.path ? Math.max(0, route.distanceKm - route.greatCircleKm - (route.diversion?.extraKm ?? 0)) : 0;

/** Extra distance flown to stay within modelled reach of potential diversion airports. */
export const diversionKm = (route: LegRoute | undefined) =>
  route?.diversion?.status === 'adjusted' ? route.diversion.extraKm : 0;

/** One or two sentences describing how a flight relates to restricted airspace, or null when clear. */
export function legAirspaceNote(route: LegRoute | undefined, unit: DistanceUnit, i18n: Pick<I18n, 't' | 'fmt'>) {
  if (!route || route.status === 'clear') return null;
  const { t, fmt } = i18n;
  const detour =
    route.path && route.avoidedPlaces.length
      ? t(
          'airspace.legDetour',
          airspacePlaces(route.avoidedPlaces, i18n),
          keepTogether(fmt.distance(detourKm(route), unit)),
        )
      : null;
  if (route.status === 'detour') return detour;
  if (route.status === 'partial')
    return [t('airspace.legPartial', airspacePlaces(route.crossedPlaces, i18n)), detour].filter(Boolean).join(' ');
  return route.crossedPlaces.length
    ? t('airspace.legUnavoided', airspacePlaces(route.crossedPlaces, i18n))
    : t('airspace.legUnavoidedUnknown');
}

/**
 * How a flight relates to modelled diversion cover, or null when it never goes beyond the 60-minute
 * threshold (no extended diversion time arises at all).
 */
export function legDiversionNote(route: LegRoute | undefined, unit: DistanceUnit, { t, fmt }: Pick<I18n, 't' | 'fmt'>) {
  const cover = route?.diversion;
  if (!cover) return null;
  const limit = fmt.number(cover.limitMin);
  if (cover.status === 'adjusted')
    return t('diversion.legAdjusted', limit, keepTogether(fmt.distance(cover.extraKm, unit)));
  if (cover.status === 'gap')
    return t(
      'diversion.legGap',
      keepTogether(fmt.duration(cover.maxMin)),
      limit,
      keepTogether(fmt.distance(cover.outsideKm, unit)),
    );
  return cover.maxMin > 60 ? t('diversion.legCovered', keepTogether(fmt.duration(cover.maxMin)), limit) : null;
}

export interface RoutingStatus {
  /** Present while restricted-airspace avoidance is on. */
  airspace: { failed: boolean } | null;
  /** Present while diversion-aware routing is on. */
  diversion: { failed: boolean } | null;
}
export interface RoutingNote {
  kind: 'airspace' | 'diversion';
  warn: boolean;
  text: string;
}

/**
 * Lines for a journey's or trip's totals, only when routing changes something: restricted airspace a
 * flight can't avoid or its extra distance, then flights beyond modelled diversion cover or the distance
 * added to stay within it. Flights are numbered in order (1-based) across the routes given.
 */
export function routingNotes(
  routes: readonly (LegRoute | undefined)[],
  unit: DistanceUnit,
  status: RoutingStatus,
  { t, fmt }: Pick<I18n, 't' | 'fmt'>,
): RoutingNote[] {
  const notes: RoutingNote[] = [];
  if (status.airspace?.failed) notes.push({ kind: 'airspace', warn: true, text: t('airspace.unavailable') });
  else if (status.airspace) {
    const unprotected = routes.findIndex((route) => airspaceWarning(route));
    const extraKm = routes.reduce((sum, route) => sum + detourKm(route), 0);
    if (unprotected >= 0)
      notes.push({
        kind: 'airspace',
        warn: true,
        text: routes.length === 1 ? t('airspace.notAvoided') : t('airspace.notAvoidedOnFlight', unprotected + 1),
      });
    else if (extraKm >= 1)
      notes.push({
        kind: 'airspace',
        warn: false,
        text: t('airspace.summaryDetour', keepTogether(fmt.distance(extraKm, unit))),
      });
  }
  if (status.diversion?.failed) notes.push({ kind: 'diversion', warn: false, text: t('diversion.unavailable') });
  else if (status.diversion) {
    const gap = routes.findIndex((route) => route?.diversion?.status === 'gap');
    const extraKm = routes.reduce((sum, route) => sum + diversionKm(route), 0);
    if (gap >= 0) {
      const longest = keepTogether(fmt.duration(routes[gap]!.diversion!.maxMin));
      notes.push({
        kind: 'diversion',
        warn: false,
        text: routes.length === 1 ? t('diversion.gap', longest) : t('diversion.gapOnFlight', gap + 1, longest),
      });
    } else if (extraKm >= 1)
      notes.push({
        kind: 'diversion',
        warn: false,
        text: t('diversion.summaryDetour', keepTogether(fmt.distance(extraKm, unit))),
      });
  }
  return notes;
}
