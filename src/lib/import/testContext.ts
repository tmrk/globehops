/** Small synthetic airport dataset for import unit tests. */
import type { Airport } from '../../types.ts';
import type { ImportContext } from './types.ts';
export function airport(ident: string, iata: string, lat: number, lng: number, id: number): Airport {
  return {
    id,
    ident,
    icao: ident,
    iata,
    lat,
    lng,
    name: ident,
    city: '',
    region: '',
    countryCode: 'GB',
    country: '',
    type: 'large',
    scheduled: true,
    keywords: [],
  };
}
export const LHR = airport('EGLL', 'LHR', 51.47, -0.45, 1);
export const JFK = airport('KJFK', 'JFK', 40.64, -73.78, 2);
export const SFO = airport('KSFO', 'SFO', 37.62, -122.38, 3);
export const HNL = airport('PHNL', 'HNL', 21.32, -157.92, 4);
export const airports = [LHR, JFK, SFO, HNL];
export const context: ImportContext = {
  airports,
  byCode: (code) => airports.find((a) => [a.ident, a.iata, a.icao].includes(code.toUpperCase())),
};
