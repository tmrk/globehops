import type { ToastState } from '../hooks/useToast.ts';

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.detail && (
            <input
              className="toast__detail"
              readOnly
              value={toast.detail}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Link"
            />
          )}
        </div>
      )}
    </div>
  );
}
