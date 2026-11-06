import { isLocale, type Locale } from './locales.ts';

export function normalizedBase(base: string): string {
  const path = base.split('/').filter(Boolean).join('/');
  return path ? `/${path}/` : '/';
}
export function localeFromPath(pathname: string, base: string): Locale | null {
  const root = normalizedBase(base);
  if (!pathname.startsWith(root)) return null;
  const segment = pathname.slice(root.length).split('/')[0];
  return isLocale(segment) ? segment : null;
}
export function stripLocalePath(pathname: string, base: string): string {
  const root = normalizedBase(base);
  const locale = localeFromPath(pathname, root);
  return locale ? root + pathname.slice(root.length + locale.length).replace(/^\//, '') : pathname;
}
export function localizedPath(base: string, locale: Locale | null): string {
  return normalizedBase(base) + (locale ? `${locale}/` : '');
}
export interface LocaleInput {
  pathname: string;
  search: string;
  base: string;
  stored?: string | null;
  languages?: readonly string[];
  timeZone?: string;
}
export type LocaleSource = 'path' | 'query' | 'stored' | 'country' | 'browser' | 'default';
export function resolveLocale(input: LocaleInput): { locale: Locale; source: LocaleSource } {
  const path = localeFromPath(input.pathname, input.base);
  if (path) return { locale: path, source: 'path' };
  const query = new URLSearchParams(input.search).get('lang');
  if (isLocale(query)) return { locale: query, source: 'query' };
  if (isLocale(input.stored)) return { locale: input.stored, source: 'stored' };
  // Static hosting has no IP lookup. The browser's zone is a country proxy, not geolocation.
  if (input.timeZone === 'Europe/Budapest') return { locale: 'hu', source: 'country' };
  if (input.timeZone === 'Europe/Stockholm') return { locale: 'sv', source: 'country' };
  for (const language of input.languages ?? []) {
    const locale = language.toLowerCase().split('-')[0];
    if (isLocale(locale)) return { locale, source: 'browser' };
  }
  return { locale: 'en', source: 'default' };
}
export function loadLocaleChoice(): string | null {
  try {
    return globalThis.localStorage?.getItem('globehops:locale') ?? null;
  } catch {
    return null;
  }
}
export function saveLocaleChoice(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem('globehops:locale', locale);
  } catch {
    /* Optional storage. */
  }
}
