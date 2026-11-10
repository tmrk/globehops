import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localizedHtml, notFoundHtml } from './html.ts';
import { LOCALES, localeInfo } from './locales.ts';
import { metadata } from './metadata.ts';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
describe.each(['/', '/globehops/'])('static locale pages under %s', (base) => {
  for (const locale of [null, ...LOCALES])
    it(`creates metadata, noscript and alternate links for ${locale ?? 'auto'}`, () => {
      const result = localizedHtml(html, base, locale);
      const language = locale ?? 'en';
      expect(result).toContain(`<html lang="${language}">`);
      expect(result).toContain(`<title>${metadata[language].title}</title>`);
      expect(result).toContain(`property="og:locale" content="${localeInfo[language].og}"`);
      expect(result).toContain(`rel="canonical" href="https://globehops.marki.im${base}${locale ? `${locale}/` : ''}"`);
      expect(result).toContain(`hreflang="x-default" href="https://globehops.marki.im${base}"`);
      for (const lang of LOCALES)
        expect(result).toContain(`hreflang="${lang}" href="https://globehops.marki.im${base}${lang}/"`);
      expect(result).toContain(metadata[language].noscript);
      expect(result).toContain(`property="og:image" content="https://globehops.marki.im${base}og-image.png"`);
      expect(result).toContain(`"urlTemplate":"https://globehops.marki.im${base}?route={route}"`);
      if (language !== 'en') expect(result).toContain(`title="${metadata[language].guide}"`);
      expect(result).toContain(`"inLanguage":"${localeInfo[language].tag}"`);
    });
});

describe.each(['/', '/globehops/'])('static 404 page under %s', (base) => {
  it('links every language to its own app page under the base', () => {
    const result = notFoundHtml(base);
    expect(result).toMatch(/^<!doctype html>/);
    expect(result).toContain(`href="${base}favicon.svg"`);
    for (const lang of LOCALES) {
      expect(result).toContain(`<p lang="${lang}">${metadata[lang].notFound} <a href="${base}${lang}/">`);
      expect(result).toContain(metadata[lang].open);
    }
  });
});
