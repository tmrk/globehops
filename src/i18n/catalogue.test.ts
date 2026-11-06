import { describe, expect, it } from 'vitest';
import { en } from './messages/en.ts';
import { hu } from './messages/hu.ts';
import { sv } from './messages/sv.ts';
import { translator, loadMessages } from './catalogue.ts';
import { LOCALES } from './locales.ts';
describe('catalogues', () => {
  for (const [locale, messages] of Object.entries({ en, hu, sv }))
    it(`${locale} is complete, nonempty and preserves interpolation slots`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(messages[key].trim(), key).not.toBe('');
        expect([...messages[key].matchAll(/\{\d+\}/g)].map((match) => match[0]).sort(), key).toEqual(
          [...en[key].matchAll(/\{\d+\}/g)].map((match) => match[0]).sort(),
        );
      }
    });
  it('loads all catalogues and interpolates values without interpreting them', async () => {
    for (const locale of LOCALES) {
      const t = translator(await loadMessages(locale));
      expect(t('picker.replace', '$&<CPH>')).toContain('$&<CPH>');
    }
  });
});
