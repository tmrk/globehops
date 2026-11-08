import { useAppUpdate } from '../hooks/useAppUpdate.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';

export function UpdateNotice() {
  const update = useAppUpdate();
  const { t } = useI18n();
  if (update.status !== 'ready' || update.dismissed) return null;
  return (
    <div className="toast update-notice">
      <span>{t('pwa.notice')}</span>
      {update.available && <span>{t('pwa.version', update.available.version)}</span>}
      <div className="app-actions">
        <button type="button" className="app-button app-button--primary" onClick={update.apply}>
          {t('pwa.update')}
        </button>
        <button type="button" className="app-button" onClick={update.dismiss}>
          {t('pwa.later')}
        </button>
      </div>
    </div>
  );
}
