import { useEffect, useRef } from 'react';
import { useHiResImagery } from '../hooks/useHiResImagery.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';

/**
 * About's switch for the optional full-resolution imagery. Off by default; turning it on asks first and names
 * the download size, which comes from the build's manifest. Cancel changes nothing.
 */
export function HiResImagerySetting() {
  const { t, fmt } = useI18n();
  const imagery = useHiResImagery();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { confirming } = imagery;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  const size = fmt.number(imagery.megabytes);
  const on = imagery.enabled || imagery.status === 'downloading';
  const status = () => {
    if (imagery.status === 'downloading') return t('hires.downloading', fmt.number(Math.round(imagery.progress * 100)));
    if (imagery.status === 'ready') return t('hires.ready');
    if (imagery.status === 'failed') return imagery.enabled ? t('hires.updateFailed') : t('hires.failed');
    return null;
  };
  const message = imagery.supported ? status() : t('hires.unsupported');
  return (
    <>
      <p>{t('hires.description', size)}</p>
      <button
        type="button"
        className="about__toggle"
        aria-pressed={on}
        disabled={!imagery.supported}
        onClick={() => (on ? void imagery.disable() : imagery.ask())}
      >
        <span>{t('hires.label')}</span>
        <span className="switch" aria-hidden="true" />
      </button>
      <p role="status" className="about__status">
        {message}
      </p>
      <dialog
        ref={dialogRef}
        className="about hires-confirm"
        aria-labelledby="hires-confirm-title"
        onClose={imagery.cancel}
        onClick={(event) => {
          if (event.target === dialogRef.current) imagery.cancel();
        }}
      >
        <div className="about__inner">
          <h3 id="hires-confirm-title">{t('hires.confirmTitle')}</h3>
          <p>{t('hires.confirmBody', size)}</p>
          <div className="app-actions">
            <button type="button" className="app-button" onClick={imagery.cancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="app-button app-button--primary" onClick={imagery.confirm}>
              {t('hires.confirmAction', size)}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
