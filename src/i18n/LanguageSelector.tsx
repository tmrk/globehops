import type { KeyboardEvent } from 'react';
import { LOCALES, localeInfo } from './locales.ts';
import { useI18n } from './I18nProvider.tsx';
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? LOCALES.length - 1
          : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + LOCALES.length) % LOCALES.length;
    (event.currentTarget.parentElement?.children[target] as HTMLButtonElement | undefined)?.focus();
    void setLocale(LOCALES[target]);
  };
  return (
    <div className="language-choice">
      <span>{t('common.language')}</span>
      <span className="segmented" role="radiogroup" aria-label={t('common.language')}>
        {LOCALES.map((value, index) => (
          <button
            key={value}
            type="button"
            role="radio"
            lang={value}
            aria-checked={locale === value}
            tabIndex={locale === value ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => {
              void setLocale(value);
            }}
          >
            {localeInfo[value].name}
          </button>
        ))}
      </span>
    </div>
  );
}
