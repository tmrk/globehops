/** The running release: SemVer from package.json plus the exact build commit and its date. */
export const APP_VERSION = __APP_VERSION__;
/** Short commit SHA of the build; empty when built outside a git checkout. */
export const APP_COMMIT = __APP_COMMIT__;
/** Commit date (YYYY-MM-DD) of the build; empty when unknown. */
export const APP_DATE = __APP_DATE__;
export const CHANGELOG_URL = 'https://github.com/tmrk/globehops/blob/main/RECENT_CHANGES.md';

/** “Build 53dabe6, 6 Nov 2026” — or an empty string when nothing is known. */
export function describeBuild(commit: string, date: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
  return [commit ? `Build ${commit}` : '', day].filter(Boolean).join(', ');
}
