import { describe, it, expect, vi } from 'vitest';
import raw from './generated/airports.json';
import { airportCode, airportPlace, decodeDataset, displayCity, loadAirports } from './airports.ts';
describe('airport decoder', () => {
  it('decodes tuples and place names', () => {
    const data = decodeDataset(raw),
      cph = data.airports.find((a) => a.iata === 'CPH')!;
    expect(data.byId.get(cph.id)).toBe(cph);
    expect(airportCode(cph)).toBe('CPH');
    expect(airportPlace(cph)).toBe('Copenhagen, Denmark');
    expect(airportCode({ ...cph, iata: null })).toBe('EKCH');
    expect(airportCode({ ...cph, iata: null, icao: null })).toBe(cph.ident);
    expect(airportPlace({ ...cph, city: 'Portland', region: 'Oregon', country: 'United States' })).toBe(
      'Portland, Oregon, United States',
    );
    expect(airportPlace({ ...cph, city: '', region: 'Capital Region' })).toBe('Denmark');
    expect(data.airports.find((a) => a.iata === 'LHR')?.type).toBe('large');
  });
  it('strips parenthetical city detail and falls back to the airport name', () => {
    const airport = decodeDataset(raw).airports.find((a) => a.iata === 'SYD')!;
    expect(displayCity({ ...airport, city: 'Sydney (Mascot)' })).toBe('Sydney');
    expect(displayCity({ ...airport, city: 'City (north) (terminal)' })).toBe('City');
    expect(displayCity({ ...airport, city: '(unknown)' })).toBe(airport.name);
    expect(displayCity({ ...airport, city: '' })).toBe(airport.name);
  });
  it('formats a real US airport with its state and country', () => {
    const jfk = decodeDataset(raw).airports.find((a) => a.iata === 'JFK')!;
    expect(jfk.region).toBe('New York');
    expect(airportPlace(jfk)).toBe(`${jfk.city}, New York, United States`);
  });
  it('rejects malformed formats, metadata, tuples and duplicate ids', () => {
    for (const invalid of [
      null,
      { ...raw, format: 2 },
      { ...raw, meta: {} },
      { ...raw, airports: [[]] },
      { ...raw, airports: [raw.airports[0], raw.airports[0]] },
      { ...raw, airports: [[...raw.airports[0].slice(0, 8), 91, ...raw.airports[0].slice(9)]] },
    ])
      expect(() => decodeDataset(invalid)).toThrow();
  });
  it('fetches with cancellation and reports HTTP failure', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(raw)));
      const signal = new AbortController().signal;
      expect((await loadAirports('/data.json', signal)).airports.length).toBe(raw.airports.length);
      expect(fetcher).toHaveBeenCalledWith('/data.json', { signal });
      fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
      await expect(loadAirports('/data.json')).rejects.toThrow('503');
    } finally {
      fetcher.mockRestore();
    }
  });
});
