import { useState } from 'react';
import { MAX_LABEL_LENGTH } from '../lib/journeyLabel.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';

interface Props {
  /** The saved name, or null for the default. */
  value: string | null;
  /** The default name, shown until one is typed. */
  placeholder: string;
  /** Accessible name, e.g. “Name of journey B”. */
  label: string;
  onChange: (name: string) => void;
}

/**
 * Edit mode's name for a journey, a compared journey or a compared trip. Keep the component keyed by its
 * journey: it holds the text as typed, so spaces survive while the saved name is trimmed.
 */
export function NameField({ value, placeholder, label, onChange }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState(value ?? '');
  return (
    <label className="row section-name">
      <span aria-hidden="true" />
      <span className="section-name__label">{t('trip.name')}</span>
      <input
        className="section-name__input"
        type="text"
        maxLength={MAX_LABEL_LENGTH}
        enterKeyHint="done"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
