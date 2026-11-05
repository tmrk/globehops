// Include Vitest's Vite configuration augmentation without changing the shared config.
import type {} from 'vitest/config';
import { describe, it, expect } from 'vitest';
import { parseCsv } from './lib/csv.ts';
describe('RFC 4180 CSV', () => {
  it('handles BOM, CRLF, LF, escaped quotes, embedded commas/newlines and empty fields', () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"x,y","say ""hi""","line\r\nbreak"\r\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'say "hi"', 'line\r\nbreak'],
      ['', '', ''],
    ]);
    expect(parseCsv('a,b\nx,y')).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ]);
    expect(parseCsv('""')).toEqual([['']]);
    expect(parseCsv('a,')).toEqual([['a', '']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('rejects malformed quoting', () => {
    for (const s of ['"unfinished', 'bad"quote,x', '"closed"oops']) expect(() => parseCsv(s)).toThrow();
  });
});
