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

/** Extra distance flown to stay out of restricted airspace. */
export const detourKm = (route: LegRoute | undefined) =>
  route?.path ? Math.max(0, route.distanceKm - route.greatCircleKm) : 0;

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
