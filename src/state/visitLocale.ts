import { localizedPath } from '../i18n/detect.ts';
import type { Locale } from '../i18n/locales.ts';

/** Locale links change this visit's address without saving a language preference. */
export function visitLocaleAddress(href: string, base: string, locale: Locale): string {
  const address = new URL(href);
  address.pathname = localizedPath(base, locale);
  address.searchParams.delete('lang');
  return address.href;
}
