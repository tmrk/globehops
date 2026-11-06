import { useI18n } from '../i18n/I18nProvider.tsx';
import { airportCode } from '../data/airports.ts';
import type { Airport, DistanceUnit } from '../types.ts';
import { IconChevronUp } from './Icons.tsx';

interface CollapsedJourneyPeekProps {
  airports: Airport[];
  hasLegs: boolean;
  totalKm: number;
  totalMin: number;
  estimated: boolean;
  unit: DistanceUnit;
  onExpand: () => void;
}

export function CollapsedJourneyPeek({
  airports,
  hasLegs,
  totalKm,
  totalMin,
  estimated,
  unit,
  onExpand,
}: CollapsedJourneyPeekProps) {
  const { t, fmt } = useI18n();
  return (
    <button type="button" className="peek" onClick={onExpand} aria-label={t('panel.showJourneyDetails')}>
      <span className="peek__route">
        {airports.length ? airports.map(airportCode).join(' → ') : t('panel.planAJourney')}
      </span>
      {hasLegs && (
        <span className="peek__totals">
          {fmt.distance(totalKm, unit)}
          {totalMin ? ` · ${estimated ? '≈ ' : ''}${fmt.duration(totalMin)}` : ''}
        </span>
      )}
      <IconChevronUp size={18} className="peek__chev" />
    </button>
  );
}
