import { useI18n } from '../i18n/I18nProvider.tsx';
import type { Airport } from '../types.ts';
import type { welcomeSuggestions } from '../data/suggestions.ts';
import { IconPlane } from './Icons.tsx';

interface WelcomeSuggestionsProps {
  suggestions: ReturnType<typeof welcomeSuggestions>;
  isExample: boolean;
  filledAirports: Airport[];
  onSelect: (from: Airport, to: Airport) => void;
}

export function WelcomeSuggestions({ suggestions, isExample, filledAirports, onSelect }: WelcomeSuggestionsProps) {
  const { t, fmt } = useI18n();
  return (
    <div className="suggestions">
      <p className="suggestions__title" id="welcome-suggestions-title">
        {t(isExample ? 'panel.tryOneOfThese' : 'panel.orTryOneOfThese')}
      </p>
      <ul role="list" aria-labelledby="welcome-suggestions-title">
        {suggestions.map(({ from, to, minutes }) => (
          <li key={to.id}>
            <button
              type="button"
              className="suggestion"
              aria-pressed={
                isExample &&
                filledAirports.length === 2 &&
                filledAirports[0].id === from.id &&
                filledAirports[1].id === to.id
              }
              onClick={() => onSelect(from, to)}
            >
              <IconPlane size={14} />
              <span className="suggestion__route">
                {fmt.city(from)} → {fmt.city(to)}
              </span>
              <span className="suggestion__duration">≈ {fmt.duration(minutes)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
