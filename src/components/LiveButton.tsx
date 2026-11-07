import { useI18n } from '../i18n/I18nProvider.tsx';

/** Like a broadcast's “Live” badge: pressed while the globe follows the wall clock in real time. */
export function LiveButton({ live, onChange }: { live: boolean; onChange: (live: boolean) => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="live-btn"
      aria-pressed={live}
      title={t(live ? 'live.showing' : 'live.show')}
      onClick={() => onChange(!live)}
    >
      <span className="live-btn__dot" aria-hidden="true" />
      {t('live.label')}
    </button>
  );
}
