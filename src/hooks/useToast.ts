import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  id: number;
  message: string;
  /** Optional text to show in a selectable field (e.g. a link when copying failed). */
  detail?: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string, detail?: string) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, detail });
    timer.current = window.setTimeout(() => setToast(null), detail ? 9000 : 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, showToast };
}
