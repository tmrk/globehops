import { describe, expect, it } from 'vitest';
import { visitLocaleAddress } from './visitLocale.ts';

describe('visit locale address', () => {
  it('uses a locale path and preserves journey parameters and fragments', () => {
    expect(
      visitLocaleAddress(
        'https://example.com/globehops/en/?route=CPH-LHR&lang=hu&clock=utc#details',
        '/globehops/',
        'sv',
      ),
    ).toBe('https://example.com/globehops/sv/?route=CPH-LHR&clock=utc#details');
  });
  it('supports a custom deployment base without adding a stored preference or query', () => {
    expect(visitLocaleAddress('https://example.com/tool/?lang=sv', '/tool/', 'en')).toBe(
      'https://example.com/tool/en/',
    );
  });
});
