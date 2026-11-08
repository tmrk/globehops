import { useAppUpdate } from '../hooks/useAppUpdate.ts';
import { useAppInstall } from '../hooks/useAppInstall.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';

export function AppSettings() {
  const { t } = useI18n();
  const update = useAppUpdate();
  const install = useAppInstall();
  const status = () => {
    switch (update.status) {
      case 'checking':
        return t('pwa.checking');
      case 'current':
        return t('pwa.current');
      case 'downloading':
        return t('pwa.downloading');
      case 'ready':
        return update.available ? t('pwa.ready', update.available.version) : t('pwa.notice');
      case 'offline':
        return t('pwa.offline');
      case 'failed':
        return t('pwa.failed');
      default:
        return null;
    }
  };
  return (
    <section>
      <h3>{t('pwa.app')}</h3>
      <p>{t('pwa.description')}</p>
      {update.supported && (
        <>
          <p role="status">{status()}</p>
          <div className="app-actions">
            {update.status === 'ready' && (
              <button type="button" className="app-button app-button--primary" onClick={update.apply}>
                {t('pwa.update')}
              </button>
            )}
            <button
              type="button"
              className="app-button"
              onClick={() => void update.check()}
              disabled={update.status === 'checking' || update.status === 'downloading'}
            >
              {t('pwa.check')}
            </button>
          </div>
        </>
      )}
      {install.canInstall && (
        <button type="button" className="app-button" onClick={() => void install.promptInstall()}>
          {t('pwa.install')}
        </button>
      )}
      {install.iosHint && <p>{t('pwa.iosHint')}</p>}
    </section>
  );
}
