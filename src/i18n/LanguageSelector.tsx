import type { KeyboardEvent } from 'react';
import { LOCALES, localeInfo } from './locales.ts';
import { useI18n } from './I18nProvider.tsx';
import { IconCheck } from '../components/Icons.tsx';
export function LanguageOptions({ menu = false, onSelect }: { menu?: boolean; onSelect?: () => void }) {
  const { locale, setLocale } = useI18n();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number;
    switch (event.key) {
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = LOCALES.length - 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = (index + LOCALES.length - 1) % LOCALES.length;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        target = (index + 1) % LOCALES.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    (event.currentTarget.parentElement?.children[target] as HTMLButtonElement | undefined)?.focus();
    void setLocale(LOCALES[target]);
  };
  return (
    <>
      {LOCALES.map((value, index) => (
        <button
          key={value}
          type="button"
          className={menu ? 'map-menu__item' : undefined}
          role="radio"
          lang={value}
          aria-checked={locale === value}
          tabIndex={locale === value ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => {
            void setLocale(value);
            onSelect?.();
          }}
        >
          {menu ? <span className="map-menu__label">{localeInfo[value].name}</span> : localeInfo[value].name}
          {menu && locale === value && <IconCheck size={18} />}
        </button>
      ))}
    </>
  );
}

export function LanguageSelector() {
  const { t } = useI18n();
  return (
    <div className="language-choice">
      <span>{t('common.language')}</span>
      <span className="segmented" role="radiogroup" aria-label={t('common.language')}>
        <LanguageOptions />
      </span>
    </div>
  );
}
