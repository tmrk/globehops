import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import cityNamesUrl from '../data/generated/city-names.json?url';
import { loadCityNames, localizedCity, type CityNameTable } from '../data/placeNames.ts';
import { replaceUrl } from '../analytics.ts';
import { loadMessages, translator, type Translate } from './catalogue.ts';
import { localizedPath, resolveLocale, saveLocaleChoice, loadLocaleChoice } from './detect.ts';
import type { Locale } from './locales.ts';
import type { Messages } from './messages/en.ts';
import { uiFormatters } from './uiFormat.ts';

interface I18n {
  locale: Locale;
  cityNames: CityNameTable | null;
  t: Translate;
  fmt: ReturnType<typeof uiFormatters>;
  setLocale: (locale: Locale) => Promise<void>;
  setVisitLocale: (locale: Locale) => Promise<void>;
}
const Context = createContext<I18n | null>(null);
export function I18nProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: Locale;
  initialMessages: Messages;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState({ locale: initialLocale, messages: initialMessages });
  const [cityNames, setCityNames] = useState<CityNameTable | null>(null);
  const needsCityNames = current.locale !== 'en';
  useEffect(() => {
    if (!needsCityNames || cityNames) return;
    const ctrl = new AbortController();
    loadCityNames(cityNamesUrl, ctrl.signal)
      .then(setCityNames)
      .catch(() => {
        // Optional exonyms: the original city names remain usable offline or after a download failure.
      });
    return () => ctrl.abort();
  }, [needsCityNames, cityNames]);
  const generation = useRef(0);
  const t = useMemo<Translate>(() => translator(current.messages), [current.messages]);
  const switchLocale = useCallback(async (locale: Locale, explicit: boolean) => {
    const ticket = ++generation.current;
    const messages = await loadMessages(locale);
    if (ticket !== generation.current) return;
    if (explicit) {
      saveLocaleChoice(locale);
      const address = new URL(window.location.href);
      address.pathname = localizedPath(import.meta.env.BASE_URL, locale);
      if (address.searchParams.has('lang')) address.searchParams.delete('lang');
      replaceUrl(address.href);
    }
    document.documentElement.lang = locale;
    // App owns the route-aware title, including same-locale picker history changes.
    setCurrent({ locale, messages });
  }, []);
  const setLocale = useCallback((locale: Locale) => switchLocale(locale, true), [switchLocale]);
  const setVisitLocale = useCallback((locale: Locale) => switchLocale(locale, false), [switchLocale]);
  useEffect(() => {
    const onPop = () => {
      const { locale } = resolveLocale({
        pathname: location.pathname,
        search: location.search,
        base: import.meta.env.BASE_URL,
        stored: loadLocaleChoice(),
        languages: navigator.languages,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      void switchLocale(locale, false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [switchLocale]);
  const fmt = useMemo(
    () => uiFormatters(current.locale, t, (airport) => localizedCity(airport, current.locale, cityNames)),
    [current.locale, t, cityNames],
  );
  const value = useMemo(
    () => ({ locale: current.locale, cityNames, t, fmt, setLocale, setVisitLocale }),
    [current.locale, cityNames, t, fmt, setLocale, setVisitLocale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
}
