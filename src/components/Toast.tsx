import { UpdateNotice } from './UpdateNotice.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { ToastState } from '../hooks/useToast.ts';

export function Toast({ toast }: { toast: ToastState | null }) {
  const { t } = useI18n();

  return (
    <div className="toast-region" role="status" aria-live="polite">
      <UpdateNotice />
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.detail && (
            <input
              className="toast__detail"
              readOnly
              value={toast.detail}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t('common.link')}
            />
          )}
        </div>
      )}
    </div>
  );
}
