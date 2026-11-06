import { useCallback, useEffect, useState } from 'react';
import { analyticsAvailableHere, disableAnalytics, enableAnalytics, type AnalyticsConsent } from '../analytics.ts';
import { loadAnalyticsConsent, saveAnalyticsConsent } from '../state/storage.ts';

export interface AnalyticsConsentState {
  /** False on local previews, forks and for visitors with Global Privacy Control or Do Not Track. */
  available: boolean;
  /** The visitor's decision; null until they choose (the notice is then shown). */
  consent: AnalyticsConsent | null;
  choose: (consent: AnalyticsConsent) => void;
}

/** The visitor's Google Analytics decision, remembered per browser; measurement starts only once granted. */
export function useAnalyticsConsent(): AnalyticsConsentState {
  const [available] = useState(analyticsAvailableHere);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(() => (available ? loadAnalyticsConsent() : null));

  useEffect(() => {
    if (!available || consent !== 'granted') return;
    // Let the globe and its textures load first; the tag is not needed for the first paint.
    if (window.requestIdleCallback && window.cancelIdleCallback) {
      const handle = window.requestIdleCallback(() => enableAnalytics(), { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => enableAnalytics(), 1200);
    return () => window.clearTimeout(handle);
  }, [available, consent]);

  const choose = useCallback(
    (next: AnalyticsConsent) => {
      if (!available) return;
      saveAnalyticsConsent(next);
      setConsent(next);
      if (next === 'denied') disableAnalytics();
    },
    [available],
  );

  return { available, consent, choose };
}
