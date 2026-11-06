/**
 * Privacy rules for Google Analytics (GA4), kept pure so they can be tested.
 *
 * - Analytics runs only on the production host, and never for visitors whose browser sends
 *   Global Privacy Control or Do Not Track.
 * - Nothing loads from Google until the visitor allows it (Consent Mode “basic”).
 * - Pages are reported without the query string or fragment: routes, dates and times stay private.
 */

export const GA_MEASUREMENT_ID = 'G-MN3ZVQ1KP4';
/** Hosts that report to the GlobeHops property; forks and local previews never do. */
export const GA_HOSTS: readonly string[] = ['tmrk.github.io'];
export const GA_PAGE_TITLE = 'GlobeHops';

export type AnalyticsConsent = 'granted' | 'denied';

export interface AnalyticsEnvironment {
  hostname: string;
  /** Production build (import.meta.env.PROD). */
  production: boolean;
  /** navigator.globalPrivacyControl */
  globalPrivacyControl?: boolean;
  /** navigator.doNotTrack (or window.doNotTrack in older browsers) */
  doNotTrack?: string | null;
}

/** Whether this page may offer analytics at all. */
export function analyticsAvailable(env: AnalyticsEnvironment): boolean {
  if (!env.production || !GA_HOSTS.includes(env.hostname)) return false;
  if (env.globalPrivacyControl === true) return false;
  return env.doNotTrack !== '1' && env.doNotTrack !== 'yes';
}

export function parseConsent(raw: string | null | undefined): AnalyticsConsent | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/** The address reported to Google: origin and path only, never the itinerary in the query. */
export function reportedLocation(href: string): string {
  try {
    const url = new URL(href);
    return url.origin + url.pathname;
  } catch {
    return '';
  }
}
