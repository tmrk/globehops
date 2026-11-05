import { describe, it, expect } from 'vitest';
import { normalizeText, tokenize } from './normalize.ts';
describe('normalization', () => {
  it('folds accents, special letters, punctuation and whitespace', () => {
    for (const [input, expected] of [
      ['Malmö', 'malmo'],
      ['København', 'kobenhavn'],
      ['John F. Kennedy', 'john f kennedy'],
      ['Zürich-Kloten', 'zurich kloten'],
      ['Æ Œ ß Ł Đ Ð Þ ı', 'ae oe ss l d d th i'],
      ['  A__42!  ', 'a 42'],
    ])
      expect(normalizeText(input)).toBe(expected);
    expect(tokenize('  Malmö - CPH  ')).toEqual(['malmo', 'cph']);
    expect(tokenize('!!!')).toEqual([]);
  });
});
