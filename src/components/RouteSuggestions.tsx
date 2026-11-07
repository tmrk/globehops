import { useId } from 'react';
import { airportCode } from '../data/airports.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { Airport } from '../types.ts';
import { IconPlane } from './Icons.tsx';

export interface SuggestedRoute {
  airports: readonly Airport[];
  minutes: number;
}

interface RouteSuggestionsProps {
  title: string;
  routes: readonly SuggestedRoute[];
  /** Toggle buttons: the suggestion the current route is (or null), shown as pressed. Omit for plain buttons. */
  chosen?: SuggestedRoute | null;
  /** Compact airport codes (city names on hover), for routes with connections. */
  codes?: boolean;
  onSelect: (route: SuggestedRoute) => void;
}

/** Welcome previews and similar alternatives for a compared journey. */
export function RouteSuggestions({ title, routes, chosen, codes = false, onSelect }: RouteSuggestionsProps) {
  const { fmt } = useI18n();
  const titleId = useId();
  return (
    <div className="suggestions">
      <p className="suggestions__title" id={titleId}>
        {title}
      </p>
      <ul role="list" aria-labelledby={titleId}>
        {routes.map((route) => {
          const cities = route.airports.map((airport) => fmt.city(airport)).join(' → ');
          return (
            <li key={route.airports.map((airport) => airport.id).join('-')}>
              <button
                type="button"
                className={`suggestion${codes ? ' suggestion--codes' : ''}`}
                aria-pressed={chosen === undefined ? undefined : route === chosen}
                title={codes ? cities : undefined}
                onClick={() => onSelect(route)}
              >
                <IconPlane size={14} />
                <span className="suggestion__route">
                  {codes ? route.airports.map(airportCode).join(' → ') : cities}
                </span>
                <span className="suggestion__duration">≈ {fmt.duration(route.minutes)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
