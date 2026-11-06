import { useI18n } from '../i18n/I18nProvider.tsx';
import { useEffect, useRef } from 'react';
import type { AnalyticsConsent } from '../analytics.ts';

interface ConsentNoticeProps {
  onChoose: (consent: AnalyticsConsent) => void;
  onDetails: () => void;
}

/**
 * The once-per-browser Google Analytics question: a modal sheet at the bottom of the screen that
 * dims the rest of the page until the visitor allows or denies. “Details” opens the About dialog's
 * privacy section on top of it.
 */
export function ConsentNotice({ onChoose, onDetails }: ConsentNoticeProps) {
  const { t } = useI18n();

  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Start on the sheet itself, so a screen reader reads the question and no button is preselected.
    dialog.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="consent"
      tabIndex={-1}
      aria-labelledby="consent-title"
      aria-describedby="consent-text"
      // Escape does not answer the question; one of the two buttons does.
      onCancel={(e) => e.preventDefault()}
    >
      <h2 id="consent-title" className="consent__title">
        {t('consent.usageStatistics')}
      </h2>
      <p id="consent-text" className="consent__text">
        {t('consent.question')}{' '}
        <button type="button" className="consent__more" onClick={onDetails}>
          {t('consent.details')}
        </button>
      </p>
      <div className="consent__actions">
        <button type="button" className="consent__deny" onClick={() => onChoose('denied')}>
          {t('consent.deny')}
        </button>
        <button type="button" className="consent__allow" onClick={() => onChoose('granted')}>
          {t('consent.allow')}
        </button>
      </div>
    </dialog>
  );
}
