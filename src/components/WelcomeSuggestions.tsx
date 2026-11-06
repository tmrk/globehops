import { useI18n } from '../i18n/I18nProvider.tsx';
import type { Airport } from '../types.ts';
import type { WelcomeSuggestion } from '../data/suggestions.ts';
import { IconPlane } from './Icons.tsx';

interface WelcomeSuggestionsProps {
  suggestions: WelcomeSuggestion[];
  /** The first-visit preview: "Try one of these" rather than "Or try one of these". */
  isExample: boolean;
  /** The suggestion the current route is, shown as pressed. */
  chosen: WelcomeSuggestion | undefined;
  onSelect: (from: Airport, to: Airport) => void;
}

export function WelcomeSuggestions({ suggestions, isExample, chosen, onSelect }: WelcomeSuggestionsProps) {
  const { t, fmt } = useI18n();
  return (
    <div className="suggestions">
      <p className="suggestions__title" id="welcome-suggestions-title">
        {t(isExample ? 'panel.tryOneOfThese' : 'panel.orTryOneOfThese')}
      </p>
      <ul role="list" aria-labelledby="welcome-suggestions-title">
        {suggestions.map((suggestion) => {
          const { from, to, minutes } = suggestion;
          return (
            <li key={to.id}>
              <button
                type="button"
                className="suggestion"
                aria-pressed={suggestion === chosen}
                onClick={() => onSelect(from, to)}
              >
                <IconPlane size={14} />
                <span className="suggestion__route">
                  {fmt.city(from)} → {fmt.city(to)}
                </span>
                <span className="suggestion__duration">≈ {fmt.duration(minutes)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
