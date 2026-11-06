import { afterEach, describe, expect, it, vi } from 'vitest';
import raw from './generated/city-names.json';
import airportData from './generated/airports.json';
import { decodeDataset, displayCity } from './airports.ts';
import { decodeCityNames, loadCityNames, localizedCity } from './placeNames.ts';

const airports = decodeDataset(airportData).airports;
const table = decodeCityNames(raw);
const get = (code: string) => airports.find((a) => a.iata === code)!;
afterEach(() => vi.unstubAllGlobals());

describe('city-name decoding and loading', () => {
  it('decodes without mutating the wire data and has no English dictionary', () => {
    expect(table.hu['Vienna|AT']).toBe('Bécs');
    expect(Object.keys(table)).toEqual(['hu', 'sv']);
    expect(raw.names.hu['Vienna|AT']).toBe('Bécs');
  });
  it.each([
    null,
    [],
    {},
    { ...raw, format: 2 },
    { ...raw, meta: null },
    { ...raw, meta: { source: '', version: 'x', license: 'x' } },
    { ...raw, names: { hu: {}, sv: [] } },
    { ...raw, names: { hu: { Vienna: 'Bécs' }, sv: {} } },
    { ...raw, names: { hu: { 'Vienna|AT': '' }, sv: {} } },
  ])('rejects invalid data: %j', (value) => {
    expect(() => decodeCityNames(value)).toThrow();
  });
  it('passes the abort signal and rejects failed requests and invalid bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(raw)));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await loadCityNames('/names.json', signal)).toEqual(table);
    expect(fetcher).toHaveBeenCalledWith('/names.json', { signal });
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(loadCityNames('/missing')).rejects.toThrow('HTTP 404');
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(loadCityNames('/bad')).rejects.toThrow('Invalid city name dataset');
  });
});

describe('localized airport cities', () => {
  it.each([
    ['CPH', 'Koppenhága', 'Köpenhamn'],
    ['VIE', 'Bécs', 'Wien'],
    ['WAW', 'Varsó', 'Warszawa'],
    ['PRG', 'Prága', 'Prag'],
    ['MUC', 'München', 'München'],
    ['CGN', 'Köln', 'Köln'],
    ['FCO', 'Róma', 'Rom'],
    ['VCE', 'Velence', 'Venedig'],
    ['FLR', 'Firenze', 'Florens'],
    ['LIS', 'Lisszabon', 'Lissabon'],
    ['ATH', 'Athén', 'Aten'],
    ['OTP', 'Bukarest', 'Bukarest'],
    ['KBP', 'Kijev', 'Kyiv'],
    ['KRK', 'Krakkó', 'Kraków'],
    ['PEK', 'Peking', 'Peking'],
    ['BUD', 'Budapest', 'Budapest'],
    ['ARN', 'Stockholm', 'Stockholm'],
    ['GOT', 'Göteborg', 'Göteborg'],
    ['BEG', 'Belgrád', 'Belgrad'],
    ['SVO', 'Moszkva', 'Moskva'],
    ['GDN', 'Gdańsk', 'Gdańsk'],
    ['JFK', 'New York', 'New York'],
    ['LHR', 'London', 'London'],
    ['YXU', 'London', 'London'],
  ])('%s has reviewed hu/sv names and preserves English displayCity', (code, hu, sv) => {
    const airport = get(code);
    expect(localizedCity(airport, 'hu', table)).toBe(hu);
    expect(localizedCity(airport, 'sv', table)).toBe(sv);
    expect(localizedCity(airport, 'en', table)).toBe(displayCity(airport));
  });
  it('falls back for unknown locales, missing/unloaded tables and unknown cities', () => {
    expect(localizedCity(get('VIE'), 'fr', table)).toBe('Vienna');
    expect(localizedCity(get('VIE'), 'hu', null)).toBe('Vienna');
    expect(localizedCity(get('VIE'), 'sv', undefined)).toBe('Vienna');
    expect(localizedCity({ ...get('VIE'), city: 'Unknown (detail)' }, 'hu', table)).toBe('Unknown');
  });
});
