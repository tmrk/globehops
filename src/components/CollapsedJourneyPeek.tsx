import { useI18n } from '../i18n/I18nProvider.tsx';
import { airportCode } from '../data/airports.ts';
import type { Airport, DistanceUnit } from '../types.ts';
import { IconPlane } from './Icons.tsx';

interface CollapsedJourneyPeekProps {
  airports: Airport[];
  /** A trip's route (its journeys' ends) in place of the active journey's airports. */
  routeText?: string;
  /** Replaces the distance and time line, e.g. a trip's distance and dates. */
  detail?: string;
  hasLegs: boolean;
  totalKm: number;
  totalMin: number;
  estimated: boolean;
  unit: DistanceUnit;
  onExpand: () => void;
}

/**
 * The collapsed sheet's one action. Without a route it invites the visitor to show a flight; with one,
 * it summarises the route and opens its details.
 */
export function CollapsedJourneyPeek({
  airports,
  routeText,
  detail,
  hasLegs,
  totalKm,
  totalMin,
  estimated,
  unit,
  onExpand,
}: CollapsedJourneyPeekProps) {
  const { t, fmt } = useI18n();
  if (!airports.length)
    return (
      <div className="peek peek--start">
        <button type="button" className="start-btn" onClick={onExpand}>
          <IconPlane size={18} className="start-btn__icon" />
          <span>{t('panel.showAFlight')}</span>
        </button>
      </div>
    );
  return (
    <button type="button" className="peek peek--route" onClick={onExpand} aria-label={t('panel.showJourneyDetails')}>
      <span className="peek__route">{routeText ?? airports.map(airportCode).join(' → ')}</span>
      {detail ? (
        <span className="peek__totals">{detail}</span>
      ) : (
        hasLegs && (
          <span className="peek__totals">
            {fmt.distance(totalKm, unit)}
            {totalMin ? ` · ${estimated ? '≈ ' : ''}${fmt.duration(totalMin)}` : ''}
          </span>
        )
      )}
    </button>
  );
}
