import { useI18n } from '../i18n/I18nProvider.tsx';
import { displayCode } from '../data/airports.ts';
import type { Airport } from '../types.ts';
import { IconPlane } from './Icons.tsx';

/** IATA code (or ICAO, dimmer); a small plane glyph for airfields without a public code. */
export function CodeBadge({ airport }: { airport: Airport }) {
  const { t } = useI18n();

  const code = displayCode(airport);
  if (!code)
    return (
      <span className="code-badge code-badge--none" title={t('a11y.noAirportCode')}>
        <IconPlane size={14} />
      </span>
    );
  return <span className={`code-badge${airport.iata ? '' : ' code-badge--icao'}`}>{code}</span>;
}
