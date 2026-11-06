export const LOCALES = ['en', 'hu', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeInfo = {
  en: { name: 'English', tag: 'en-GB', hreflang: 'en', og: 'en_GB' },
  hu: { name: 'Magyar', tag: 'hu-HU', hreflang: 'hu', og: 'hu_HU' },
  sv: { name: 'Svenska', tag: 'sv-SE', hreflang: 'sv', og: 'sv_SE' },
} as const;
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some((locale) => locale === value);
}
