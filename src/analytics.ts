/**
 * Google Analytics 4 (gtag.js), loaded only after the visitor allows it.
 *
 * Privacy rules live in lib/analytics.ts. Here:
 * - Consent Mode v2 “basic”: no request reaches Google before consent. Advertising storage, user
 *   data and personalisation are always denied; Google signals and ad personalisation are off.
 * - One page view per visit, reported as the bare address and a fixed title, because the real
 *   address and document title contain the itinerary.
 * - The app rewrites its address on every edit and scrub. Those writes use the browser's own
 *   History methods, captured before gtag.js can wrap them, so they never count as page views.
 * - Withdrawing consent sets Google's documented opt-out flag and removes the _ga cookies.
 */
import {
  analyticsAvailable,
  entryType,
  GA_MEASUREMENT_ID,
  GA_PAGE_TITLE,
  reportedLocation,
  type AnalyticsConsent,
} from './lib/analytics.ts';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const nativeReplaceState = History.prototype.replaceState;
const nativePushState = History.prototype.pushState;
const initialSearch = window.location.search;
const optOutFlag = `ga-disable-${GA_MEASUREMENT_ID}`;

/** Rewrites the address without creating a history entry or an analytics page view. */
export function replaceUrl(url: string, state: unknown = window.history.state): void {
  nativeReplaceState.call(window.history, state, '', url);
}

/** Adds a history entry (e.g. for the mobile picker) without an analytics page view. */
export function pushUrl(url: string, state: unknown): void {
  nativePushState.call(window.history, state, '', url);
}

/** Whether this visitor may be asked at all: production host, no GPC or Do Not Track. */
export function analyticsAvailableHere(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return analyticsAvailable({
    hostname: window.location.hostname,
    production: import.meta.env.PROD,
    globalPrivacyControl: nav.globalPrivacyControl,
    doNotTrack: nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? null,
  });
}

let state: 'off' | 'loading' | 'on' = 'off';

function gtag(..._args: unknown[]): void {
  // gtag.js expects the Arguments object itself, not an array.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer!.push(arguments);
}

/** Starts (or resumes) measurement after consent. Safe to call repeatedly. */
export function enableAnalytics(): void {
  if (!analyticsAvailableHere()) return;
  (window as unknown as Record<string, unknown>)[optOutFlag] = false;
  if (state !== 'off') {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  state = 'loading';
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = gtag;
  gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  gtag('js', new Date());
  const referrer = document.referrer ? reportedLocation(document.referrer) : '';
  gtag('config', GA_MEASUREMENT_ID, {
    page_location: reportedLocation(window.location.href),
    ...(referrer ? { page_referrer: referrer } : {}),
    page_title: GA_PAGE_TITLE,
    entry: entryType(initialSearch),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  script.onload = () => (state = 'on');
  // Blocked or offline: the app carries on; queued commands are simply never sent.
  script.onerror = () => (state = 'on');
  document.head.appendChild(script);
}

/** Stops measurement for the rest of the visit and removes Google Analytics cookies. */
export function disableAnalytics(): void {
  (window as unknown as Record<string, unknown>)[optOutFlag] = true;
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  const host = window.location.hostname;
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    for (const domain of ['', `; domain=${host}`, `; domain=.${host}`]) {
      document.cookie = `${name}=; max-age=0; path=/${domain}`;
    }
  }
}

/** Sends one event when measurement is on; otherwise does nothing. Never pass route details. */
export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}): void {
  if (state === 'off' || (window as unknown as Record<string, unknown>)[optOutFlag] === true) return;
  window.gtag?.('event', name, params);
}

export type { AnalyticsConsent };
