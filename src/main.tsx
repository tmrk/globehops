import './pwa/install.ts';
import { appUpdater } from './pwa/updates.ts';
import { nativeFeel } from './pwa/nativeFeel.ts';
import { I18nProvider } from './i18n/I18nProvider.tsx';
import { loadMessages } from './i18n/catalogue.ts';
import { loadLocaleChoice, resolveLocale } from './i18n/detect.ts';
import { replaceUrl } from './analytics.ts';
import { readShareTarget } from './state/shareTarget.ts';
import { setPendingShare } from './state/pendingShare.ts';
import { visitLocaleAddress } from './state/visitLocale.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Barlow sets the interface; Martian Mono (weight and width axes) sets codes, times and figures.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource-variable/martian-mono/standard.css';
import './styles/app.css';
import App from './App.tsx';
import { loadReduceMotion } from './state/storage.ts';
import { effectiveReducedMotion } from './lib/motion.ts';

nativeFeel();
if (import.meta.env.PROD && 'serviceWorker' in navigator) void appUpdater.start();

document.documentElement.dataset.motion = effectiveReducedMotion(
  loadReduceMotion(),
  window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
  ? 'reduce'
  : 'full';

async function start() {
  const shared = readShareTarget(location.search);
  if (shared) {
    replaceUrl(location.pathname + (shared.kind === 'link' ? shared.query : ''));
    if (shared.kind !== 'link') setPendingShare(shared);
  }
  const resolved = resolveLocale({
    pathname: location.pathname,
    search: location.search,
    base: import.meta.env.BASE_URL,
    stored: loadLocaleChoice(),
    languages: navigator.languages,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const messages = await loadMessages(resolved.locale);
  document.documentElement.lang = resolved.locale;
  document.title = messages['common.documentTitle'];
  if (resolved.source === 'query')
    replaceUrl(visitLocaleAddress(window.location.href, import.meta.env.BASE_URL, resolved.locale));
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing application root.');
  createRoot(root).render(
    <StrictMode>
      <I18nProvider initialLocale={resolved.locale} initialMessages={messages}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}
void start();
