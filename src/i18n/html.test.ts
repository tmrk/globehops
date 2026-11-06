import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localizedHtml } from './html.ts';
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
      expect(result).toContain(`rel="canonical" href="https://tmrk.github.io${base}${locale ? `${locale}/` : ''}"`);
      expect(result).toContain(`hreflang="x-default" href="https://tmrk.github.io${base}"`);
      for (const lang of LOCALES)
        expect(result).toContain(`hreflang="${lang}" href="https://tmrk.github.io${base}${lang}/"`);
      expect(result).toContain(metadata[language].noscript);
      expect(result).toContain(`property="og:image" content="https://tmrk.github.io${base}og-image.png"`);
      expect(result).toContain(`"urlTemplate":"https://tmrk.github.io${base}?route={route}"`);
      if (language !== 'en') expect(result).toContain(`title="${metadata[language].guide}"`);
      expect(result).toContain(`"inLanguage":"${localeInfo[language].tag}"`);
    });
});
